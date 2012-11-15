var app = require('express')();
var server = require('http').createServer(app);
var youjs = require(__dirname + '/../lib/server.js');
var you = new youjs(server);
server.listen(5000);
var everyone = you.everyone;

app.get('/', function(req, res) {
	console.log(req.path);
	res.sendfile(__dirname + '/index.html');
});

app.get('/*', function(req,res) {
	console.log(req.path);
	res.sendfile(require('path').join(__dirname, req.path));
});

everyone.you.serverSaySomething = function(message, callback) {
	callback({name: 'thomas', surname: 'zilz'});
}

var secret = you.getGroup('secret');
secret.you.secretTest = function(message, callback) {
	callback('error', 'hey this is a secret, dont tell anyone');
}

you.events.on('connect', function(client) {
	secret.join(client.id);
});


you.events.on('clientReady', function(clientId) {
	var client = you.getClient(clientId);
	console.log('Calling fatCat');
	client.you.fatCat('hello from server', function(res) {
		console.log(res);
	});
});
