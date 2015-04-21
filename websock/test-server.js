var WebSocketServer = require('ws').Server, 
    uuid = require("uuid"),
    redis = require("redis"),
    request = require("request"),
    async = require("async"),
    util = require("util");

var
    apibase = "https://faraday.mobilada.net/~yalazi/fetfrip/",
    wss = new WebSocketServer( { port: 8888 }),
    clients = {};

redisc = init_redis();



var logout_user = function(key) {
        console.log("client %s disconnected", key);

        clients[key] = null;
        delete clients[key];

        redisc.hget(key, 'posts', function (err, posts) {
            if (posts == null || posts == "") return;
            posts = posts.split(",")
            for (i in posts) {
                async.series([
                    function(){  
                        redisc.lrem('onscreen_posts', 1, posts[i], redis.print)
                    },
                    function(){ 
                        redisc.srem('post_clients_' + posts[i], key, redis.print)
                    }
                ]);
            }
            redisc.del(key, function() {});
        })
    }


wss.on('connection', function(ws) {
  
    var key = uuid.v4();
    createClient(ws, key);

    ws.on('message', function(message, flags) {
        console.log('received: %s from client %s', message, key);
        processMessage(ws, message, key);
    });
    ws.on('close', function () { logout_user(key); });

}); 


function init_redis () {
    var  redis_client = redis.createClient();
    var  redis_client_pubsub = redis.createClient();

    redis_client.on("error", function (err) {
        console.log("Error " + err);
    });
    redis_client_pubsub.on("error", function (err) {
        console.log("Error " + err);
    });

    redis_client_pubsub.subscribe("comment-updates");
    redis_client_pubsub.on('message', pubsubCommentUpdate)

    return redis_client;
}

function pubsubCommentUpdate(channel, message) {
    if (channel == "comment-updates") {
        console.log("comment-updates: %s", message)
        var data = JSON.parse(message);
        var post = data.post;
        var id = data.comment;
        redisc.lindex("onscreen_posts", data.post, function (err, index) {
            if (!err) {
                console.log("Post is onscreen: %d", data.post);
                redisc.smembers("post_clients_" + post, function (err, members) {
                    if (!err) {
                        for (i in members) {
                            console.log("Sending to client: %s", key);
                            var key = members[i];
                            if (key) getComments(clients[key], key, post, id - 1);
                        }
                    }
                });
            }
        })
    }
}

function processMessage(ws, message, key) {

    try {
        var message = JSON.parse(message);
    } catch(e) {
        console.log(e);
    }

    switch (message.command) {
        case 'ready':
            ws.send(JSON.stringify({result: "success"}));
            ws.send(JSON.stringify({command: "identify", key: key}));
        case 'identity':
            // Record Identification.
            redisc.hmset(key, "cookie", message.cookie, "username", message.username, redis.print)
            break;
        case 'posts':
            redisc.hget(key, "posts", function (err, posts) {
                if (!err && posts) {
                    posts = posts.split(",");
                    console.log("Removing posts %s", posts)
                    for (i in posts) {
                        console.log("XXXX Removing post %d", posts[i])
                        redisc.lrem('onscreen_posts', 1, posts[i], redis.print)
                        redisc.srem('post_clients_' + posts[i], key, redis.print)
                    }
                }
                redisc.hmset(key, "posts", message.posts, redis.print);
                for (i in message.posts) {
                    console.log("Pushing: %d", message.posts[i]);
                    redisc.lpush('onscreen_posts', message.posts[i], redis.print)
                    redisc.sadd('post_clients_' + message.posts[i], key, redis.print)
                }
            });
            break;
        case 'new_comments':
            // Get new comments for a post
            try {
                getComments(ws, key, message.post, message.comment)
            } catch (e) {
                console.log(e);
            }
            break;
        break;
    }
}
function createClient(ws, key) {
    clients[key] = ws;
}

function getComments(ws, key, post, comment) {
    if (!post && !comment) return;
    console.log("Getting new comments for client %s, p: %d c: %d", key, post, comment);
    redisc.hget(key, "cookie", function (err, cookie) {
        if (err) {
            console.log("Error for client: %s e: %s", key, err)
            return;
        }
        if (cookie == null || cookie == "") {
            console.log("User is logged out");
            logout_user(key);
            return;
        }
        var url = util.format("%s?r=%s&model=%s&id=%d&cid=%d", apibase, 'comment/comment/apicomment','Post', post, comment);

        var jar = request.jar();
        var cookies = cookie.split(";");

        for (i in cookies) {
            var c = cookies[i];
            if (c.length) {
                var cook = request.cookie(c);
                try {
                    jar.setCookie(cook, url)
                } catch(e) {
                    console.log("Error with cookie: %s", c);
                }
            }
        }
        request.get({ uri: url, jar: jar }, function(err, response, body) {
                try {
                    ws.send(JSON.stringify({ command: 'new_comments', post: post, comments: JSON.parse(body) }));
                } catch(e) {
                    console.log("Error %s", e);
                    if (body.match(/AccountLoginForm/)) {
                        logout_user(key);
                    }
                }
            }
        );
    });
}
