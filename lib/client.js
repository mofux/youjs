var you = (function() {
	var util = {
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
						if (listener != null) listener(obj);
					}
				}
			}
		}
	}

	var EventEmitter = null;
	var io = null;

	// this client works for node.js and a web browser
	// here we detect the environment we are working in
	if (typeof window === 'undefined') {
		// we're in node.js
		io = require('socket.io-client');
		EventEmitter = require('events').EventEmitter;
	} else {
		// we're in a browser
		io = window.io;
		EventEmitter = util.EventEmitter;
		uri = window.location.host;
	}

	var youjs = function(uri) {
		// if we're in a browser and no uri is passed, we assume that the socket.io server is running on the same server/port that is serving this file
		if (typeof window !== 'undefined') uri = window.location.host;
		this.core.init(uri, this);
	}

	youjs.prototype = {

		core: {

			init: function(uri, youjs) {

				var self = this;
				var currentId = 0;						// whenever we call a function on the server and have a callback, we use this id to match the callback with our called function
				var cbMap = {};							// a map that stores the callbacks that we expect the server to call once it has executed its code
				var groupFunctions = {};				// a map of functions that the server provides for every group. the key is the group name
				var groupReady = {};					// whenever a group is ready (synced all functions from the server) we register the state in this map. the key is the group name

				var options = {
					tansports: ['websocket'],
					'force new connection': true
				};

				this.events = new EventEmitter();
				this.socket = io.connect(uri, options);

				var socket = this.socket;

				socket.on('connect', function() {
					// we are connected, sync function calls
					var clientFunctions = [];
					for (var fnName in youjs) {
						// only sync functions that don't call themself core, ready or are functions that we synced from the server
						if (fnName === 'core') continue;
						if (fnName === 'ready') continue;

						var isGroupFunction = false;
						for (var groupName in groupFunctions) {
							if (groupFunctions[groupName].indexOf(fnName) !== -1) {
								isGroupFunction = true;
								break;
							}
						}

						if (isGroupFunction === true) continue;
						clientFunctions.push(fnName);
					}
					console.log('sending functions to server: ', clientFunctions);
					socket.emit('clientFunctions', clientFunctions);

					socket.on('groupFunctions', function(obj) {
						console.log('received group functions:', obj);
						// remove old functions
						if (groupFunctions[obj.group]) {
							for (var i=0; i<groupFunctions[obj.group].length; i++) {
								var fnName = groupFunctions[obj.group][i];
								console.log('removing function ' + fnName);
								delete self[fnName];
							}
						}

						// store new functions
						if (obj.functions !== null) {
							groupFunctions[obj.group] = obj.functions;

							// create a warpper for the received functions
							for (var i=0; i<obj.functions.length; i++) {
								var fnName = obj.functions[i];
								youjs[fnName] = function() {
									//console.log('remote function ' + fnName + ' got called with arguments:', arguments);
									// get a new id to store the callback
									var id = currentId++;

									// build the argument map passed to the servers
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
									cbMap[id] = cb;
									//console.log('calling remote function ' + fnName + ' with computed arguments ', args);
									socket.emit('functionCalled', { fnName: fnName, id: id, args: args });
								}
								if (groupReady[obj.group] !== true) {
									groupReady[obj.group] = true;
									self.events.emit('groupReady', obj.group);
									if (obj.group === 'everyone') self.events.emit('ready');
								}
							}
						}
					});

					socket.on('functionExecuted', function(opts) {
						// server executed the function and called back
						//console.log('server came back with a response for function ', opts);
						if (opts && opts.id !== null && opts.args !== null) {
							if (cbMap[opts.id]) {
								// execute the callback
								cbMap[opts.id].apply(this, opts.args);
								cbMap[opts.id] = null;
								delete cbMap[opts.id];
							}
						}
					});

					socket.on('clientFunctionCalled', function(opts) {
						console.log('server called function ' + opts.fnName + ' with opts:', opts);
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
								console.log('clientFunctionExecuted:', result);
								socket.emit('clientFunctionExecuted', result);
							}
							opts.args.push(cb);
							console.log('calling ' + opts.fnName + ' with arguments ', opts.args);
							if (youjs[opts.fnName]) {
								youjs[opts.fnName].apply(this, opts.args);
							} else {
								console.log('server called server function "' + opts.fnName + '" that is not known to the client.', youjs);
							}
						}
					});

					socket.on('disconnect', function() {
						self.events.emit('disconnect');
					});

				});

			}
		},

		// ready is fired once the "everyone" group is synced. note that other groups may not be synced at that time .
		// You can listen for group ready by registering on youjs.core.events.on('groupReady', function(group) {...} )
		ready: function(callback) {
			this.core.events.on('ready', callback);
		}
	}

	return new youjs('http://localhost:5000');

})();

you.fatCat = function(message, callback) {
	callback('client echoing your message ' + message);
}

you.core.events.on('groupReady', function(group) {

	console.log('group ready: ' + group);
	/*
	you.serverSaySomething('test ', function(message) {
		console.log(message);
	});
	*/

	if (you.secretTest) {
		you.secretTest('got it', function(err, message) {
			console.log(err, message);
		});
	}

});

