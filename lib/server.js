var socketio = require('socket.io');
var events = require('events');

var you = function(server) {
	this.init(server);
}

you.prototype = {

	init: function(server) {

		var self = this;
		var io = socketio.listen(server);
		io.set('log level', 1);
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
				cbMap: {},
				currentId: 0
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
			socket.on('clientFunctions', function(functions) {
				console.log('received client functions:', functions);
				var client = self.getClient(socket.id);
				// create a wrapper for the client functions
				if (functions != null && functions instanceof Array) {
					for (var i=0; i<functions.length; i++) {
						var fnName = functions[i];
						client.you[fnName] = function() {
							// get a new id to store the callback
							var id = client.currentId ++;

							// build the argument map passed to the client
							var args = [];
							var cb = null;

							for (var argNum in arguments) {
								var arg = arguments[argNum];
								// we won't pass functions, and if there is a function then it is most likely the callback, which we would expect at the end of the argument list
								if (typeof arg !== 'function') {
									args.push(arg);
								} else {
									cb = arg;
								}
							}
							// register the callback in the callback map
							client.cbMap[id] = cb;
							client.socket.emit('clientFunctionCalled', { fnName: fnName, id: id, args: args });
						}
					}
					self.events.emit('clientReady', client.clientId);
				} else {
					console.log('invalid or empty clientFunctions object passed. Must be an Array');
				}
			});

			socket.on('clientFunctionExecuted', function(opts) {
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
			socket.on('functionCalled', function(opts) {
				if (opts && opts.fnName !== null && opts.args !== null) {
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
						socket.emit('functionExecuted', result);
					}
					opts.args.push(cb);
					console.log('calling ' + opts.fnName + ' with arguments ', opts.args);

					// get the groups the client is member of
					for (var groupName in self.groups) {
						var scope = self.clients[socket.id];
						if (self.groups[groupName].you[opts.fnName] && self.groups[groupName].members[socket.id]) {
							self.groups[groupName].you[opts.fnName].apply(scope, opts.args);
						} else {
							// group has no function with that name, just ignore it.
						}
					}
				}
			});
		});
	},

	// send all group functions to the client
	sendFunctions: function(clientId) {
		var self = this;
		if (self.clients[clientId]) {
			var socket = this.clients[clientId].socket;

			// resolve functions for all groups the client is member of
			for (var groupName in self.groups) {
				var functions = [];
				if (self.groups[groupName].members[clientId]) {
					for (var fnName in self.groups[groupName].you) {
						functions.push(fnName);
					}
				} else {
					// client is not member of this group (yet)
				}
				socket.emit('groupFunctions', { group: groupName, functions: functions} );
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
				you: {},
				join: function(clientId) {
					console.log('client with clientId ' + clientId + ' is joining group ' + groupName);
					if (self.clients[clientId]) {
						self.groups[groupName].members[clientId] = self.clients[clientId];
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
	}

}

var app = require('express')();
var server = require('http').createServer(app);
var youjs = new you(server);

server.listen(5000);

app.get('/', function(req, res) {
	console.log(req.path);
	res.sendfile(__dirname + '/index.html');
});

app.get('/*', function(req,res) {
	console.log(req.path);
	res.sendfile(require('path').join(__dirname, req.path));
});

youjs.everyone.you.serverSaySomething = function(message, callback) {
	callback({name: 'thomas', surname: 'zilz'});
}

var secret = youjs.getGroup('secret');
secret.you.secretTest = function(message, callback) {
	callback('error', 'hey this is a secret, dont tell anyone');
}

youjs.events.on('connect', function(client) {
	secret.join(client.id);
});


youjs.events.on('clientReady', function(clientId) {
	var client = youjs.getClient(clientId);
	console.log('Calling fatCat');
	client.you.fatCat('hello from server', function(res) {
		console.log(res);
	});
});
