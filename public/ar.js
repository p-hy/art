// constant for async delays
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function initAR(socket, foreignStream, foreignStreamDisplay) {

    var mouse = new THREE.Vector2();
    var mouseNorm = new THREE.Vector2();
    var cursorActive = false;

    var lastTime = 0;

    // webGL renderer instantiation
    var renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });

    renderer.setSize(foreignStreamDisplay.clientWidth, foreignStreamDisplay.clientHeight);
    // renderer will create canvas element in html for AR graphics
    foreignStreamDisplay.appendChild(renderer.domElement);

    // scene and camera instantiation for AR matrix calculations
    var renderFunctions = [];
    var arToolkitContext, markerControls;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera();
    scene.add(camera);

    // objects for containing 'marker packages', i.e., relations
    // between fiducial markers, the AR graphics to show, and the
    // smart action which is triggered when raytraced (clicked)
    var markerRoots = {};
    Object.keys(smartActions).forEach(function (uuid) {
        markerRoots[uuid] = new THREE.Group;
        markerRoots[uuid].name = uuid;
        scene.add(markerRoots[uuid]);
    });

    // source instantiation, i.e., the webRTC stream coming from the robot
    var arToolkitSource = new THREEx.ArToolkitSource({
        sourceType: 'video',
        sourceWidth: 1920,
        sourceHeight: 1080,
        displayWidth: foreignStreamDisplay.clientWidth,
        displayHeight: foreignStreamDisplay.clientHeight
    });

    arToolkitSource.init(function onReady() {
        foreignStreamDisplay.appendChild(arToolkitSource.domElement);
        triggerARContext();
        onResize();
    });
    arToolkitSource.domElement.srcObject = foreignStream;

    window.addEventListener('resize', function () {
        onResize();
    });
    function onResize() {
        arToolkitSource.onResizeElement();
        arToolkitSource.copyElementSizeTo(renderer.domElement);
        if (arToolkitContext.arController !== null) {
            arToolkitSource.copyElementSizeTo(arToolkitContext.arController.canvas);
        };
    };


    // unique THREEx instantiations for AR.js functionality
    function triggerARContext() {

        // defines some parameters for how markers are detected
        arToolkitContext = new THREEx.ArToolkitContext({
            cameraParametersUrl: '/camera-para.dat',
            detectionMode: 'mono',
            canvasWidth: foreignStreamDisplay.clientWidth,
            canvasHeight: foreignStreamDisplay.clientHeight
        });

        // handles matrices between THREE and THREEx
        arToolkitContext.init(function onCompleted() {
            arToolkitContext.setProj;
            //camera.projectionMatrix.copy(arToolkitContext.getProjectionMatrix())
            window.arToolkitContext = arToolkitContext;
        });

        // relevant fiducial markers (.patt files) associated with each smart action package
        Object.keys(smartActions).forEach(function (uuid) {
            markerControls = new THREEx.ArMarkerControls(arToolkitContext, markerRoots[uuid], {
                type: 'pattern',
                patternUrl: 'assets/fiducial/' + uuid + '.patt',
            });
        });
    };

    // cursor setup
    var geometry = new THREE.PlaneGeometry(0.2, 0.2);

    var cursorMaterial = new THREE.MeshBasicMaterial({
        map: THREE.ImageUtils.loadTexture('/assets/cursor.png'),
        depthTest: false,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide
    });
    var cursorSelectMaterial = new THREE.MeshBasicMaterial({
        map: THREE.ImageUtils.loadTexture('/assets/cursor_select.png'),
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide
    });
    var cursorPlane = new THREE.Mesh(geometry, cursorMaterial);

    // cursor rendering
    renderFunctions.push(function () {

        var raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        var intersects = {};
        Object.keys(smartActions).forEach(function (uuid) {
            intersects[uuid] = raycaster.intersectObjects(markerRoots[uuid].children);

            if (intersects[uuid].length > 0 && markerRoots[uuid].position.x + markerRoots[uuid].position.y != 0) {
                cursorActive = true;
            };
        });

        if (cursorActive) {
            cursorPlane.material = cursorSelectMaterial;
            cursorPlane.scale.set(0.466, 0.7);
        } else {
            cursorPlane.material = cursorMaterial;
            cursorPlane.scale.set(0.667, 1);
        };

        var cursorPos = new THREE.Vector3(mouse.x, mouse.y, 0);

        cursorPos.unproject(camera);
        cursorPos.sub(camera.position).normalize();
        var distance = (-3 - camera.position.z) / cursorPos.z;

        cursorPlane.position.copy(camera.position).add(cursorPos.multiplyScalar(distance));

        if (document.body.style.cursor == 'none') {
            scene.add(cursorPlane);
        } else {
            scene.remove(cursorPlane);
        };
    });

    // microsoft profile rendering

    const panel = new ThreeMeshUI.Block({
        width: 1.0,
        height: 1.0,
        padding: 0.2,
        fontFamily: 'Roboto-msdf.json',
        fontTexture: 'Roboto-msdf.png',
        contentDirection: 'row',
        justifyContent: 'center'
    });

    const photo = new ThreeMeshUI.Block({
        width: 0.3,
        height: 0.3
    });

    panel.add(photo);

    const name = new ThreeMeshUI.Block({
        width: 0.7,
        height: 0.3,
        backgroundOpacity: 0
    });

    panel.add(name);

    const nameText = new ThreeMeshUI.Text({
        content: "Isaac Phypers",
        fontSize: 0.1
    });

    name.add(nameText);

    new THREE.TextureLoader().load('https://www.business2community.com/wp-content/uploads/2017/08/blank-profile-picture-973460_640.png', (texture) => {
        photo.set({
          backgroundTexture: texture,
        });
      });

    //scene.add(panel);

    panel.rotateX(-1.5708);

    renderFunctions.push(function () {
        ThreeMeshUI.update();
    });

    // all functions in renderFunctions will run once per frame
    renderFunctions.push(function () {
        // wait for async functions
        if (!arToolkitContext || !arToolkitSource || !arToolkitSource.ready) {
            return;
        };

        // updates THREEx context
        arToolkitContext.update(arToolkitSource.domElement);
    })
        ; (function () {

            // geometry - single double-sided plane
            var geometry = new THREE.PlaneGeometry(1, 1);

            // defines the AR models which are shown when fiducial markers are 
            // detected. again, unique for each smart action package, as per db contents
            var materials = {};
            var materialsConfirm = {};
            var planes = {};

            Object.keys(smartActions).forEach(function (uuid) {
                // materials for specific smart action
                materials[uuid] = new THREE.MeshBasicMaterial({
                    map: THREE.ImageUtils.loadTexture('/assets/ar-icon/' + uuid + '.png'),
                    transparent: true,
                    opacity: 1,
                    side: THREE.DoubleSide
                });
                materialsConfirm[uuid] = new THREE.MeshBasicMaterial({
                    map: THREE.ImageUtils.loadTexture('/assets/ar-icon-confirm/' + uuid + '.png'),
                    transparent: true,
                    opacity: 1,
                    side: THREE.DoubleSide
                });

                // instance of geometry, with smart action specific parameters (i.e., materials)
                planes[uuid] = new THREE.Mesh(geometry, materials[uuid]);
                planes[uuid].rotateX(-1.5708);
                markerRoots[uuid].add(panel); //planes[uuid]);

                // callback for instance of geometry when raytraced (clicked)
                planes[uuid].callback = function () {
                    (async () => {
                        planes[uuid].material = materialsConfirm[uuid];
                        // actual location ifttt is triggered via a webhook
                        socket.emit('ifttt-event', smartActions[uuid].webhook);
                        await delay(2000);
                        planes[uuid].material = materials[uuid];
                    })();
                };
            });
        })();

    renderFunctions.push(function () {
        renderer.render(scene, camera);
    });

    // render loop
    requestAnimationFrame(function animate() {
        renderFunctions.forEach(function (renderFunction) {
            renderFunction();
        });
        requestAnimationFrame(animate);
    });

    document.getElementById('toolbar').addEventListener('mouseover', function (event) {
        document.body.style.cursor = 'default';
    });
    document.getElementById('local-view').addEventListener('mouseover', function (event) {
        document.body.style.cursor = 'default';
    });

    renderer.domElement.addEventListener('mouseover', function (event) {
        document.body.style.cursor = 'none';
    }, false);

    renderer.domElement.addEventListener('mousemove', function (event) {
        mouse.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
        mouse.y = - (event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
        mouseNorm.x = (mouse.x - -1) / (1 - -1);
        mouseNorm.y = (mouse.y - -1) / (1 - -1);

        if (lastTime < Date.now() - 200) {
            lastTime = Date.now();
            socket.emit('click-to-drive', mouseNorm.x, 1 - mouseNorm.y, false, ROBOT_ID);
        };

    }, false);

    // onclick handling for renderer (canvas), both for raytracing 
    // and sending to robot for click-to-drive functionality
    var raycaster = new THREE.Raycaster();

    renderer.domElement.addEventListener('click', function (event) {
        socket.emit('click-to-drive', mouseNorm.x, 1 - mouseNorm.y, true, ROBOT_ID);

        raycaster.setFromCamera(mouse, camera);

        // ray trace for each smart action package
        var intersects = {};
        Object.keys(smartActions).forEach(function (uuid) {
            intersects[uuid] = raycaster.intersectObjects(markerRoots[uuid].children);

            if (intersects[uuid].length > 0 && markerRoots[uuid].position.x + markerRoots[uuid].position.y != 0) {
                intersects[uuid][0].object.callback();
            };
        });
    }, false);

    socket.on('health-msg', message => {
        if (message.target == ROBOT_ID && message.type == 'highlight-cursor') {
            cursorActive = message.status;
        };
    });
};

