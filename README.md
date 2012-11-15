youjs
=====

now.js inspired library for syncing functions between node.js server and web/node.js clients using socket.io

Usage
=====

Install From npm
----------------

`npm install youjs` or `npm install youjs -g` to install globally



YouJS is a Node.js module. The client javascript (you.js) is served by the YouJS server.


YouJS uses the excellent <a href="https://github.com/LearnBoost/Socket.IO-node">socket.io</a> library.

Setup
==============

**1. On the server**


    var httpServer = require('http').createServer(function(req, response){ /* Serve your static files */ })
    httpServer.listen(8080);

    var youjs = require("youjs");
    var you = new youjs(httpServer);
    var everyone = you.everyone;

    everyone.you.logStuff = function(msg){
        console.log(msg);
    }

**2. On the client**
<pre><code>
&lt;script type="text/javascript" src="/youjs/you.js">&lt;/script>

&lt;script type="text/javascript"&gt;
  you.ready(function(){
    // "Hello World!" will print on server
    you.logStuff("Hello World!");
  });
&lt;/script>
</code></pre>