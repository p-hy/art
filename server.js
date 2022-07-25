// IMPORTS

// password and uuid utilities
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';

// database and file utilities
import { LowSync, JSONFileSync } from 'lowdb';
import { join, dirname } from 'path';
import cors from 'cors';
import fs from 'fs';

// routing and data abstractions
import express from 'express';
import fetch from 'node-fetch';
import favicon from 'serve-favicon';
import expressFileupload from 'express-fileupload';
import greenlock from 'greenlock-express';
import bodyParser from 'body-parser';

// server utilities
import { createServer, get } from 'https';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

// microsoft utility
import * as Queries from './public/ms-queries.js';

// CONSTANTS 

// constant for async delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// absolute path to dir
const __dirname = dirname(fileURLToPath(import.meta.url));

// server instantiation
const app = express();
const server = createServer(app);

// server configuration
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(favicon(join(__dirname, 'public', 'favicon.ico')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(expressFileupload());
app.use(cookieParser());
app.use(cors({ origin: '*' }));

// database configuration
const file = join(__dirname, 'db/db.json');
const adapter = new JSONFileSync(file);
const db = new LowSync(adapter);
db.read();

// UTILITY FUNCTIONS

function hashedPwd(pwd) {
    const sha256 = crypto.createHash('sha256');
    const hash = sha256.update(pwd).digest('base64');
    return hash;
};
function newAuthToken() {
    return crypto.randomBytes(36).toString('hex');
}
function deleteElement(array, value) {
    return array.filter(function (x) {
        return x != value;
    });
};

var activeRobots = {};

// volatile record of logged in users
const adminAuthTokens = {};
const driverAuthTokens = {};

// volatile data of logged in users
const activeUsers = {};

// HTTPS

greenlock.init({
    packageRoot: __dirname,
    configDir: "./greenlock.d",
    maintainerEmail: "psyip1@nottingham.ac.uk",
    cluster: false
}).ready(socketWorker);

function socketWorker(glx) {
    var server = glx.httpsServer();
    const io = new Server(server);

    // SOCKET COMMUNICATION (including webRTC)
    io.on('connection', socket => {
        socket.on('robot-alive', robotId => {
            activeRobots[socket.id] = robotId;
        });
        // webRTC establishment
        socket.on('join-robot', (robotId, userId) => {
            socket.join(robotId);
            socket.broadcast.emit('user-connected', userId);
            socket.on('disconnect', () => {
                socket.broadcast.emit('user-disconnected', userId);
            });
        });
        // driver -> robot control message
        socket.on('control-msg', (msg, robotId) => {
            var message = {
                target: robotId,
                content: msg
            };
            io.emit('control-msg', message);
        });
        // driver -> robot click-to-drive message
        socket.on('click-to-drive', (x, y, att, robotId) => {
            var message = {
                target: robotId,
                attempt: att,
                xCoord: x,
                yCoord: y
            };
            io.emit('click-to-drive', message);
        });
        // robot -> driver health message (e.g., battery)
        socket.on('health-msg', (flavour, filling, robotId) => {
            var message = {
                target: robotId,
                type: flavour,
                status: filling,
            };
            io.emit('health-msg', message);
        });
        // ifttt event trigger
        socket.on('ifttt-event', (url) => {
            get(url);
        });
        socket.on('chat-msg', (chat, msg) => {
            // Oh my god fix
            fetch(Queries.sendChatURL(chat), Queries.sendChatBody(Object.values(activeUsers)[0].access_token, msg))
                .then(response => response.json())
                .then(test => {
                    console.log(test);
                })
        });
        socket.on('get-office-card', user_id => {
            fetch(Queries.getOtherUserDataURL(user_id), Queries.getDataBody(Object.values(activeUsers)[0].access_token))
                .then(response => response.json())
                .then(info => {
                    fetch(Queries.getUserPresenceURL(user_id), Queries.getDataBody(Object.values(activeUsers)[0].access_token))
                        .then(response => response.json())
                        .then(presence => {
                            io.emit('office-card', { name: info.displayName, presence: presence.availability });
                        });
                });
        });
        // disconnect
        socket.on('disconnect', reason => {
            io.emit('robot-disconnected', activeRobots[socket.id]);
            delete activeRobots[socket.id];
        });
    });

    glx.serveApp(app);
};

// ROUTING

// route precedent to collect cookie(s) from browser for auth
app.use((req, res, next) => {
    const authToken = req.cookies['AuthToken'];
    if (driverAuthTokens[authToken]) {
        req.driverId = driverAuthTokens[authToken];
        if (adminAuthTokens[authToken]) {
            req.adminId = adminAuthTokens[authToken];
        }
    };
    next();
});

app.get('/', (req, res) => {
    if (req.driverId) {
        res.redirect('/select');
    };
    res.render('login', {
        error: req.query.error
    });
});


// ms login and logout handling
app.get('/ms-login', (req, res) => {
    res.redirect(Queries.login);
});

app.get('/ms-logout', (req, res) => {
    delete adminAuthTokens[req.cookies['AuthToken']];
    delete driverAuthTokens[req.cookies['AuthToken']];
    delete activeUsers[req.cookies['AuthToken']];
    res.redirect(Queries.logout);
});

app.get('/ms-socket', (req, res) => {
    fetch(Queries.requestTokenURL, Queries.requestTokenBody(req.query.code))
        .then(response => response.json())
        .then(loginData => {
            if (loginData.error != undefined) {
                res.redirect('/?error=user');
            } else {
                fetch(Queries.getUserDataURL, Queries.getDataBody(loginData.access_token))
                    .then(response => response.json())
                    .then(userData => {
                        /*
                        fetch(Queries.getUserPhotoURL, Queries.getDataBody(loginData.access_token))
                            .then(response => response.blob())
                            .then(userPhotoData => {
                                var imageUrl = URL.createObjectURL(userPhotoData);
                            });
                        */

                        db.read();
                        var authToken = newAuthToken();
                        if (db.data.drivers.includes(userData.id)) {
                            activeUsers[userData.id] = {
                                access_token: loginData.access_token,
                                refresh_token: loginData.refresh_token,
                                name: userData.displayName,
                                email: userData.mail
                            }
                            driverAuthTokens[authToken] = userData.id;
                            if (db.data.admins.includes(userData.id)) {
                                adminAuthTokens[authToken] = userData.id;
                            }
                        } else {
                            res.redirect('/?error=user');
                        }
                        res.cookie('AuthToken', authToken);
                        res.redirect('/select');
                    });
            };
        });
});

// robot selection
app.get('/select', (req, res) => {
    if (req.driverId) {
        db.read();
        res.render('select', {
            name: activeUsers[req.driverId].name,
            admin: req.adminId ? "true" : "false",
            robots: db.data.robots,
            activeRobots: Object.values(activeRobots),
            error: req.query.error
        });
    } else {
        res.redirect('/');
    };
});

// admin landing page
app.get('/admin-dashboard', (req, res) => {
    if (req.adminId) {
        res.render('admin-dashboard', {
            name: activeUsers[req.adminId].name
        });
    } else {
        res.redirect('/');
    };
});

// admin manage drivers
app.get('/manage-drivers', (req, res) => {
    if (req.adminId) {
        db.read();
        res.render('manage-drivers', {
            name: activeUsers[req.adminId].name,
            activeInvites: db.data.active_invites,
            activeDrivers: db.data.drivers
        });
    } else {
        res.redirect('/');
    };
});
app.post('/generate-invite', (req, res) => {
    db.data.active_invites.push(uuidv4());
    db.write();
    res.redirect('/manage-drivers');
});
app.post('/delete-invite/:invite', (req, res) => {
    db.data.active_invites = deleteElement(db.data.active_invites, req.params.invite);
    db.write();
    res.redirect('/manage-drivers');
});
app.post('/delete-driver/:email', (req, res) => {
    delete db.data.drivers[req.params.email];
    db.write();
    res.redirect('/manage-drivers');
});

// admin manage robots
app.get('/manage-robots', (req, res) => {
    if (req.adminId) {
        db.read();
        res.render('manage-robots', {
            name: activeUsers[req.adminId].name,
            activeRobots: db.data.robots
        });
    } else {
        res.redirect('/');
    };
});
app.post('/delete-robot/:uuid', (req, res) => {
    delete db.data.robots[req.params.uuid];
    db.write();
    res.redirect('/manage-robots');
});
app.post('/add-robot', (req, res) => {
    const { name, location } = req.body;
    var uuid = uuidv4();
    db.data.robots[hashedPwd(uuid)] = {
        "private": uuid,
        "name": name,
        "location": location
    };
    db.write();
    res.redirect('/manage-robots');
});

// admin manage smart actions
app.get('/smart-actions', (req, res) => {
    if (req.adminId) {
        db.read();
        res.render('smart-actions', {
            name: activeUsers[req.adminId].name,
            smartActions: db.data.smart_actions
        });
    } else {
        res.redirect('/');
    };
});
app.post('/delete-smart-action/:uuid', (req, res) => {
    fs.unlinkSync('public/assets/fiducial/' + req.params.uuid + '.patt');
    fs.unlinkSync('public/assets/ar-icon/' + req.params.uuid + '.png');
    fs.unlinkSync('public/assets/ar-icon-confirm/' + req.params.uuid + '.png');

    db.read();
    delete db.data.smart_actions[req.params.uuid];
    db.write();

    res.redirect('/smart-actions');
});
app.get('/smart-action', (req, res) => {
    if (req.adminId) {
        res.render('smart-action', {
            name: activeUsers[req.adminId].name
        });
    } else {
        res.redirect('/');
    };
});
app.post('/new-smart-action', (req, res) => {
    const { name, webhook } = req.body;
    const fiducial = req.files.fiducial;
    const arIcon = req.files.arIcon;
    const arIconC = req.files.arIconConfirm;

    const uuid = uuidv4();
    fiducial.mv('public/assets/fiducial/' + uuid + '.patt');
    arIcon.mv('public/assets/ar-icon/' + uuid + '.png');
    arIconC.mv('public/assets/ar-icon-confirm/' + uuid + '.png');

    db.read();
    db.data.smart_actions[uuid] = {
        "name": name,
        "webhook": webhook
    };
    db.write();

    res.redirect('/smart-actions');
});

// robot-side interface and controller
app.get('/robot/:uuid', (req, res) => {
    db.read();
    if (db.data.robots[hashedPwd(req.params.uuid)] != null) {
        res.render('robot', {
            robotId: hashedPwd(req.params.uuid),
            robotName: db.data.robots[hashedPwd(req.params.uuid)].name
        });
    } else {
        res.redirect('/');
    };
});

// driver interface and controller
app.get('/:uuid', (req, res) => {
    if (req.driverId) {
        db.read();
        res.render('driver', {
            robotId: req.params.uuid,
            robotName: db.data.robots[req.params.uuid].name,
            robotLocation: db.data.robots[req.params.uuid].location,
            smartActionsData: JSON.stringify(db.data.smart_actions),
            officeCardsData: JSON.stringify(db.data.ms_office_cards)
        });
    } else {
        res.redirect('/');
    };
});
