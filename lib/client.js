var you = (function() {

  var util = {
    // node.js like eventemitter that also works in a browser
    EventEmitter: function() {
      this.listeners = {};
      this.on = function(evt, listener) {
        if (!this.listeners[evt] || this.listeners[evt] instanceof Array === false) {
          this.listeners[evt] = [];
        }
        this.listeners[evt].push(listener);
      }
      this.emit = function(evt, obj) {
        if (this.listeners[evt] && this.listeners[evt] instanceof Array === true) {
          for (var i=0; i<this.listeners[evt].length; i++) {
            var listener = this.listeners[evt][i];
            if (typeof listener !== 'undefined') listener(obj);
          }
        }
      }
    },
    // retruns all fqns (fully qualified function names) for the object passed
    getFqns: function(rootFqn, obj) {
      console.log('getFqns(rootFqn,obj)', rootFqn, obj);
      
      var result = [];
      if (typeof obj === 'object') {
        for (var propName in obj) {
          if (obj.__proto__ && obj.__proto__[propName]) continue;
          console.log('processing property ' + propName);
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
    // retruns the function resolved from the fqn
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
          return getFnFromFqn(rootObj[piece], newFqn);
        }
        return null;
      }
    }
  }

  var EventEmitter = null;
  var io = null;
  var uri = null;

  // this client works for node.js and a web browser
  // here we detect the environment we are working in
  if (typeof window === 'undefined') {
    // we're in node.js
    io = require('socket.io-client');
  } else {
    // we're in a browser
    io = window.io;
    uri = window.location.origin;
  }

  var youjs = function() {
    this.core.init(uri, this);
  }

  youjs.prototype = {

    core: {

      init: function(uri, youjs) {

        var fqnMap = {};
        var cbMap = {};
        var socket = io.connect(uri);
        var cbId = 0;
        var self = this;
        var ready = {};

        this.socket = socket;
        this.events = new util.EventEmitter();

        // takes an array of fqns and adds them to the root object.
        resolveFqns = function(rootObj, fqns, groupName) {
          console.log('parsing fqns: ', fqns, rootObj);
          for (var i=0; i<fqns.length; i++) {
            var fqn = fqns[i];
            var path = fqn.split('.');
            if (typeof rootObj === 'object') {
              var activePathObj = rootObj;
              for (var p=0; p<path.length; p++) {
                var piece = path[p];
                if (typeof piece !== 'string' || piece.length === 0) continue;
                var isLastPiece = p === path.length -1;
                if (typeof activePathObj[piece] === 'undefined') {
                  if (isLastPiece === true) {
                    activePathObj[piece] = function() {
                      var id = cbId ++;
                      var args = [];
                      var cb = null;
                      var fqn = this.fqn;
                      var groupName = groupName;

                      for (var argNum in arguments) {
                        var arg = arguments[argNum];
                        if (typeof arg !== 'function') {
                          args.push(arg);
                        } else {
                          cb = arg;
                        }
                      }
                      cbMap[id] = cb;
                      console.log('server please execute ', groupName, fqn, id, args);
                      socket.emit('execute', {grp: groupName, fqn: fqn, id: id, args: args});
                    }.bind({fqn: fqn});
                    activePathObj = rootObj;
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
              console.log('invalid root object', rootObj);
            }
          }
        }

        socket.on('connect', function() {
          // sync fqns calls
          var fqns = util.getFqns('', youjs);
          for (var groupName in fqnMap) {
            for (var i=0; i<fqns.length; i++) {
              if (fqnMap[groupName].indexOf(fqns[i]) !== -1) fqns.splice(i, 1);
            }
          }
          socket.emit('fqns', fqns);
        });

        socket.on('fqns', function(obj) {
          // received fqns from server (key: groupName, value: fqn array)
          for (var groupName in obj) {
            fqnMap[groupName] = obj[groupName];
            resolveFqns(youjs, fqnMap[groupName], groupName);
            if (typeof ready[groupName] === 'undefined') {
              ready[groupName] = true;
              self.events.emit('groupReady', groupName);
              if (groupName === 'everyone') self.events.emit('ready');              
            }
          }
        });

        socket.on('executed', function(cb) {
          // server exectued function (opts.id, opts.args)
          if (cb && cb.id !== null && cb.args !== null) {
            if (cbMap[cb.id]) {
              cbMap[cb.id].apply(this, cb.args);
              cbMap[cb.id] = null;
              delete cbMap[cb.id];
            }
          }
        });

        socket.on('execute', function(opts) {
          // server wants us to execute a function
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
              socket.emit('executed'. result);
            }
            opts.args.push(cb);
            var fn = util.getFnFromFqn(youjs, opts.fqn);
            if (typeof fn === 'function') {
              fn.apply(this, opts.args);
            } else {
              console.log('could not resolve function for fqn ' + opts.fqn);
            }
          }
        });

      }

    },
    // emitted when the everyone group is ready (other groups may not be ready at that time) 
    ready: function(callback) {
      this.core.events.on('ready', callback);
    }
    
  }

  return new youjs('localhost');

})();