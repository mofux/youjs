var socketio = require('socket.io');
var events = require('events');

var youjs = function(server) {
  this.init(server);
}

var util = {
  getFqns: function(rootFqn, obj) {
    var result = [];
    if (typeof obj === 'object') {
      for (var propName in obj) {
        if (typeof obj[propName] === 'function') {
          result.push(rootFqn + '.' + propName);
          continue;
        }
        if (typeof obj[propName] === 'object') {
          var more = util.getFqns(rootFqn + '.' + propName, obj[propName]);
          for (var i=0; i<more.length; i++) {
            result.push(more[i]);
          }
        }
      }
    }
    return result;
  },
  getFnFromFqn: function(rootObj, fqn) {
    var path = fqn.split('.');
    if (path.length > 0 && path[0].length === 0) path.shift();
    for (var i=0; i<path.length; i++) {
      var piece = path[i];
      if (typeof rootObj[piece] === 'function') {
        return rootObj[piece];
      }
      if (typeof rootObj[piece] === 'object') {
        path.shift();
        var newFqn = path.join('.');
        return util.getFnFromFqn(rootObj[piece], newFqn);
      }
      return null;
    }
  },
  resolveFqns: function(client, fqns) {
    client.fqns = fqns;
    for (var i=0; i<fqns.length; i++) {
      var fqn = fqns[i];
      var path = fqn.split('.');
      if (typeof client.you === 'object') {
        var activePathObj = client.you;
        for (var p=0; p<path.length; p++) {
          var piece = path[p];
          if (typeof piece !== 'string' || piece.length === 0) continue;
          var isLastPiece = p === path.length -1;
          if (typeof activePathObj[piece] === 'undefined') {
            if (isLastPiece === true) {
              activePathObj[piece] = function() {
                var id = client.cbId ++;
                var args = [];
                var cb = null;
                for (var argNum in arguments) {
                  var arg = arguments[argNum];
                  if (typeof arg !== 'function') {
                    args.push(arg);
                  } else {
                    cb = arg;
                  }
                }
                client.cbMap[id] = cb;
                client.socket.emit('execute', {fqn: this.fqn, id: id, args: args});
              }.bind({fqn: fqn});
              activePathObj = client.you;
            } else {
              activePathObj[piece] = {};
              activePathObj = activePathObj[piece];
            }
          } else {
            if (typeof activePathObj[piece] === 'object') {
              activePathObj = activePathObj[piece];
            }
          }
        }
      } else {
        console.log('invalid client.you object', client.you);
      }
    }
  },
  refreshGroupFqns: function(group, client) {
    if (client && client.you && group && group.you) {
      if (group.members[client.clientId]) {
        var fqns = client.fqns;
        for (var i=0; i<fqns.length; i++) {
          var fqn = fqns[i];
          var path = fqn.split('.');
          var activePathObj = group.you;
          group.fqns[fqns[i]] = true;
          for (var p=0; p<path.length; p++) {
            var piece = path[p];
            if (typeof piece !== 'string' || piece.length === 0) continue;
            var isLastPiece = p === path.length -1;
            if (typeof activePathObj[piece] === 'undefined') {
              if (isLastPiece === true) {
                activePathObj[piece] = function() {
                  for (var clientId in group.members) {
                    var client = group.members[clientId];
                    var fn = util.getFnFromFqn(client.you, this.fqn);
                    if (typeof fn === 'function') {
                      var args = [];
                      for (var argNum in arguments) args.push(arguments[argNum]);
                      fn.apply(client, args);
                    } else {
                      console.log('client ' + client.clientId + ' has no function ' + this.piece + ' (fqn: ' + this.fqn + '). Clients you space is ', client.you);
                    }
                  }
                }.bind({piece: piece, fqn: fqn});
                activePathObj = group.you;
              } else {
                activePathObj[piece] = {};
                activePathObj = activePathObj[piece];
              }
            } else {
              if (typeof activePathObj[piece] === 'object') {
                activePathObj = activePathObj[piece];
              }
            }
          }
        }
      } else {
        console.log('will not refresh group functions because client ' + client.clientId + ' is not member of group ' + group.name);
      }
    } else {
      console.log('cannot refresh group functions because client or group is invalid');
    }
    console.log('finished rebuilding group functions: ', group.you);
  }
}

youjs.prototype = {

  init: function(server) {

    var self = this;
    this.serveClient(server);
    var io = socketio.listen(server);
    io.set('log level', 1);
    this.server = io;
    this.clients = {};
    this.groups = {};
    this.events = new events.EventEmitter();

    // create and register default group (everyone)
    this.everyone = this.getGroup('everyone');

    io.sockets.on('connection', function (socket) {

      // register client
      var client = {
        clientId: socket.id,
        socket: socket,
        you: {},
        fqns: [],
        cbMap: {},
        cbId: 0
      }
      self.clients[client.clientId] = client;
      self.everyone.join(client.clientId);
      self.events.emit('connect', socket);

      // socket disconnected
      socket.on('disconnect', function() {
        console.log('client with clientId ' + socket.id + ' disconnected.');
        self.clientDisconnected(socket.id);
      });

      // received functions from clients you space
      socket.on('fqns', function(fqns) {
        console.log('received client functions:', fqns);
        var client = self.getClient(socket.id);
        // create a wrapper for the client functions
        if (fqns != null && fqns instanceof Array) {
          util.resolveFqns(client, fqns);
          util.refreshGroupFqns(self.everyone, client);
          self.events.emit('clientReady', client.clientId);
        } else {
          console.log('invalid or empty fqns passed. Must be an Array');
        }
      });

      socket.on('executed', function(opts) {
        // client executed the function and called back
        if (opts && opts.id !== null && opts.args !== null) {
          var client = self.getClient(socket.id);
          if (client.cbMap[opts.id]) {
            // execute the callback
            client.cbMap[opts.id].apply(client, opts.args);
            client.cbMap[opts.id] = null;
            delete client.cbMap[opts.id];
          }
        }
      });

      // a group function got called from a client
      socket.on('execute', function(opts) {
        if (opts && opts.fqn !== null && opts.args !== null) {
          var cb = function() {
            var result = {
              id: opts.id,
              args: []
            };
            for (var argNum in arguments) {
              if (typeof arguments[argNum] !== 'function') {
                result.args.push(arguments[argNum]);
              }
            }
            socket.emit('executed', result);
          }
          opts.args.push(cb);

          // get the groups the client is member of
          var fn = util.getFnFromFqn(self.groups[opts.grp].you, opts.fqn);
          var scope = self.clients[socket.id];
          if (typeof fn === 'function') {
            console.log('calling ' + opts.fqn + ' with arguments ', opts.args);
            fn.apply(scope, opts.args);
          } else {
            console.log('could not resolve fqn ' + opts.fqn + ' of group ' + opts.grp);
          }
        }
      });
    });
  },

  // send all group functions to the client
  sendFunctions: function(clientId) {
    console.log('sending functions to ' + clientId);
    var self = this;
    if (self.clients[clientId]) {
      var client = this.clients[clientId];
      var socket = client.socket;

      // resolve functions for all groups the client is member of
      for (var groupName in self.groups) {
        var fqnMap = {};
        var toExclude = self.groups[groupName].fqns;
        
        if (self.groups[groupName].members[clientId]) {
          var fqns = util.getFqns('', self.groups[groupName].you);
          var result = [];
          for (var i=0; i<fqns.length; i++) {
            if (toExclude[fqns[i]] !== true) result.push(fqns[i]);
          }
          fqnMap[groupName] = result;
        } else {
          // client is not member of this group (yet)
        }
        console.log('sending server fqns to client (fqns, excluded, result): ', fqns, toExclude, result);
        socket.emit('fqns', fqnMap);
      }
    } else {
      console.log('Cannot send server functions to client ' + clientId + ' because the client is not registered');
    }
  },

  // gets or creates a group
  getGroup: function(groupName) {
    console.log('getGroup for ' + groupName);
    var self = this;
    if (!this.groups[groupName]) {
      var group = {
        name: groupName,
        members: {},
        fqns: {},
        you: {},
        join: function(clientId) {
          if (self.clients[clientId]) {
            console.log('client with clientId ' + clientId + ' is joining group ' + groupName);
            self.groups[groupName].members[clientId] = self.clients[clientId];
            util.refreshGroupFqns(self.groups[groupName], self.clients[clientId]);
            self.sendFunctions(clientId);
          }
        },
        leave: function(clientId) {
          this.members[clientId] = null;
          delete this.members[clientId];
        }
      }
      self.groups[groupName] = group;
    }
    return this.groups[groupName];
  },

  // removes a group
  removeGroup: function(groupName) {
    this.groups[groupName] = null;
    delete this.groups[groupName];
  },

  // receive the client object from the clientId (FYI equals socket.id)
  getClient: function(clientId, callback) {
    if (typeof this.clients[clientId] !== 'undefined') {
      return this.clients[clientId];
    }
  },

  // a client got disconnected
  clientDisconnected: function(clientId) {
    // remove all references to the client
    for (var groupName in this.groups) {
      if (this.groups[groupName].members[clientId]) this.groups[groupName].leave(clientId);
      if (this.clients[clientId]) {
        this.clients[clientId] = null;
        delete this.clients[clientId];
      }
    }
  },

  // serve the youjs client file automatically
  serveClient: function(server) {
    var self = this;
    if ('undefined' !== typeof server) {
      // serve the client file when requested
      var clientPath = __dirname + '/client.js';
      var defaultListeners = server.listeners('request');
      server.removeAllListeners('request');

      server.on('request', function(req, res) {
        console.log('got request for ' + req.url);
        if (req.url.indexOf('/youjs/you.js') !== -1) {
          var fs = require('fs');
          fs.exists(clientPath, function(exists) {
            if (exists) {
              fs.readFile(clientPath, function(err, content) {
                if (err) {
                  console.log('error reading file ' + clientPath);
                  res.writeHead(500);
                  res.end();
                } else {
                  try {
                    console.log('sending ' + clientPath + ' to client');
                    res.writeHead(200, { 'Content-Type': 'text/javascript' });
                    res.end(req.method !== 'HEAD' && content ? content : '', 'utf-8');
                  } catch (e) {
                    console.log('error:', e);
                  }

                }
              });
            } else {
              res.writeHead(404);
              res.end();
            }
          });
        } else {
          // handle default listeners
          for (var i in defaultListeners) {
            defaultListeners[i].call(server, req, res);
          }
        }
      });
    } else {
      console.log('http server not initialized');
    }
  }

}

module.exports = youjs;
