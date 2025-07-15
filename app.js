// Target coordinates (latitude, longitude, altitude in meters)
const TARGET = {
    lat: 69.705561,
    lng: 18.832721,
    alt: 488.8
};

// DOM elements
const permissionScreen = document.getElementById('permission-screen');
const loadingScreen = document.getElementById('loading-screen');
const errorScreen = document.getElementById('error-screen');
const startButton = document.getElementById('start-button');
const retryButton = document.getElementById('retry-button');
const errorMessage = document.getElementById('error-message');
const loadingStatus = document.getElementById('loading-status');
const cameraFeed = document.getElementById('camera-feed');
const arOverlay = document.getElementById('ar-overlay');

// App state
let currentLocation = null;
let deviceOrientation = {
    alpha: 0,
    beta: 0,
    gamma: 0
};
let compassHeading = 0;
let screenOrientation = 0; // Track screen orientation

// Three.js variables
let scene, camera, renderer;
let destinationMarker, raycaster, pointer;

// Initialize event listeners
startButton.addEventListener('click', initApp);
retryButton.addEventListener('click', initApp);

// Initialize the application
function initApp() {
    permissionScreen.style.display = 'none';
    errorScreen.style.display = 'none';
    loadingScreen.style.display = 'flex';
    loadingStatus.textContent = 'Requesting device permissions...';

    // Request all necessary permissions in sequence
    requestLocationAccess()
        .then(() => {
            loadingStatus.textContent = 'Location access granted. Requesting camera...';
            return requestCameraAccess();
        })
        .then(() => {
            loadingStatus.textContent = 'Camera access granted. Requesting motion sensors...';
            return requestMotionAccess();
        })
        .then(() => {
            loadingStatus.textContent = 'All permissions granted. Initializing AR...';
            initThreeJS();
            loadingScreen.style.display = 'none';
            startLocationTracking();
        })
        .catch(error => {
            console.error('Error during initialization:', error);
            loadingScreen.style.display = 'none';
            errorScreen.style.display = 'flex';
            errorMessage.textContent = error.message;
        });
}

// Request camera access
async function requestCameraAccess() {
    try {
        const constraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: window.innerWidth, max: 1280 },
                height: { ideal: window.innerHeight, max: 720 }
            },
            audio: false
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        cameraFeed.srcObject = stream;
        
        return new Promise((resolve, reject) => {
            cameraFeed.onloadedmetadata = () => {
                cameraFeed.play()
                    .then(() => resolve())
                    .catch(reject);
            };
            cameraFeed.onerror = reject;
        });
    } catch (error) {
        console.error('Camera access error:', error);
        throw new Error(`Camera access denied: ${error.message}`);
    }
}

// Request location access
async function requestLocationAccess() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported by this browser'));
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            position => {
                currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    alt: position.coords.altitude || 0
                };
                console.log('Initial location:', currentLocation);
                resolve();
            },
            error => {
                console.error('Location error:', error);
                reject(new Error(`Location access denied: ${error.message}`));
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
    });
}

// Start continuous location tracking
function startLocationTracking() {
    if (!navigator.geolocation) return;
    
    navigator.geolocation.watchPosition(
        position => {
            currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                alt: position.coords.altitude || 0
            };
            updateMarkerPosition();
        },
        error => {
            console.error('Location tracking error:', error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        }
    );
}

// Request device motion and orientation access
async function requestMotionAccess() {
    return new Promise((resolve, reject) => {
        // Check for iOS 13+ permission requirement
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        setupOrientationListeners();
                        resolve();
                    } else {
                        reject(new Error('Motion sensors access denied'));
                    }
                })
                .catch(error => {
                    console.error('Permission request error:', error);
                    reject(error);
                });
        } else {
            // For other browsers
            setupOrientationListeners();
            
            // Give some time for orientation data to start coming in
            setTimeout(() => {
                resolve();
            }, 500);
        }
    });
}

// Setup orientation event listeners
function setupOrientationListeners() {
    // Device orientation (gyroscope)
    window.addEventListener('deviceorientation', handleOrientation, true);
    
    // Device motion (accelerometer)
    window.addEventListener('devicemotion', handleMotion, true);
    
    // Screen orientation changes
    window.addEventListener('orientationchange', handleScreenOrientationChange, true);
    
    // Initialize screen orientation
    handleScreenOrientationChange();
    
    console.log('Orientation listeners set up');
}

// Handle screen orientation changes
function handleScreenOrientationChange() {
    // Get screen orientation
    if (screen.orientation) {
        screenOrientation = screen.orientation.angle;
    } else if (window.orientation !== undefined) {
        screenOrientation = window.orientation;
    } else {
        screenOrientation = 0;
    }
    
    console.log('Screen orientation:', screenOrientation);
    
    // Update marker position after orientation change
    setTimeout(() => {
        updateMarkerPosition();
    }, 100);
}

// Handle device motion (accelerometer)
function handleMotion(event) {
    // We can use this for additional stabilization if needed
    // For now, we'll just log it
    if (event.accelerationIncludingGravity) {
        // console.log('Motion data:', event.accelerationIncludingGravity);
    }
}

// Handle device orientation changes
function handleOrientation(event) {
    if (event.alpha === null || event.beta === null || event.gamma === null) {
        return;
    }
    
    // Update orientation values
    deviceOrientation.alpha = event.alpha || 0;
    deviceOrientation.beta = event.beta || 0;
    deviceOrientation.gamma = event.gamma || 0;
    
    // Calculate compass heading - simpler approach
    if (event.webkitCompassHeading !== undefined) {
        // iOS Safari
        compassHeading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android Chrome and others
        compassHeading = 360 - event.alpha;
    }
    
    // Update marker position
    updateMarkerPosition();
    
    // Update compass display
    updateCompassDisplay();
}

// Update compass display
function updateCompassDisplay() {
    const compassContent = document.getElementById('compass-content');
    if (!compassContent) return;
    
    // Calculate how much to offset the compass strip
    // Each compass mark represents 30 degrees, so we need to calculate the offset
    const degreesPerMark = 30;
    const pixelsPerDegree = 30 / degreesPerMark; // 30px between marks / 30 degrees
    
    // Calculate offset based on compass heading
    const offset = (compassHeading * pixelsPerDegree) % (360 * pixelsPerDegree);
    
    // Apply transform to create rolling effect
    compassContent.style.transform = `translateX(-${offset}px)`;
}

// Calculate distance between two geographic points (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c; // Distance in meters
}

// Calculate bearing between two geographic points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
             Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    const θ = Math.atan2(y, x);
    
    return (θ * 180 / Math.PI + 360) % 360; // Bearing in degrees (0-360)
}

// Initialize Three.js scene
function initThreeJS() {
    // Create scene
    scene = new THREE.Scene();
    
    // Create camera (perspective) - wider FOV for less zoom
    const fov = 90; // Increased from 75 for wider view
    const aspect = window.innerWidth / window.innerHeight;
    const near = 0.1;
    const far = 1000;
    camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(0, 0, 0);
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({
        canvas: arOverlay,
        alpha: true,
        antialias: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // Transparent background
    
    // Create destination marker (red sphere with glow effect)
    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.9
    });
    destinationMarker = new THREE.Mesh(geometry, material);
    
    // Add a larger outer sphere for better visibility
    const outerGeometry = new THREE.SphereGeometry(0.25, 16, 16);
    const outerMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        wireframe: true
    });
    const outerSphere = new THREE.Mesh(outerGeometry, outerMaterial);
    destinationMarker.add(outerSphere);
    
    // Add a pulsing effect
    const pulseGeometry = new THREE.SphereGeometry(0.3, 16, 16);
    const pulseMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        wireframe: true
    });
    const pulseRing = new THREE.Mesh(pulseGeometry, pulseMaterial);
    destinationMarker.add(pulseRing);
    
    scene.add(destinationMarker);
    
    // Create marker label
    createMarkerLabel();
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
    
    console.log('Three.js initialized');
}

// Create text label for the destination marker
function createMarkerLabel() {
    // Create a canvas for the text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;
    
    // Draw background with rounded corners
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw border
    context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    context.lineWidth = 2;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    
    // Draw text
    context.font = 'bold 48px Arial';
    context.fillStyle = '#ff0000';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('DESTINATION', canvas.width / 2, canvas.height / 2 - 30);
    
    context.font = '32px Arial';
    context.fillStyle = 'white';
    context.fillText('Target Location', canvas.width / 2, canvas.height / 2 + 30);
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // Create sprite material
    const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        alphaTest: 0.1
    });
    
    // Create sprite and add to destination marker
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 0.8, 0); // Position above the sphere
    sprite.scale.set(2, 1, 1);
    destinationMarker.add(sprite);
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Update marker position based on device orientation
function updateMarkerPosition() {
    if (!currentLocation || !destinationMarker) return;
    
    // Calculate bearing to target (0-360 degrees)
    const targetBearing = calculateBearing(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Calculate relative bearing (difference between where we're facing and where target is)
    let relativeBearing = targetBearing - compassHeading;
    
    // Normalize to -180 to 180 range
    while (relativeBearing > 180) relativeBearing -= 360;
    while (relativeBearing < -180) relativeBearing += 360;
    
    // Convert to radians for Three.js calculations
    const angleRad = (relativeBearing * Math.PI) / 180;
    
    // Position marker on a circle around the camera
    const radius = 4;
    const x = radius * Math.sin(angleRad);
    const z = -radius * Math.cos(angleRad); // Negative Z is forward in Three.js
    
    // Calculate vertical position based on altitude difference
    const altitudeDiff = TARGET.alt - (currentLocation.alt || 0);
    const horizontalDistance = calculateDistance(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Calculate elevation angle and limit it
    const elevationAngle = Math.atan2(altitudeDiff, horizontalDistance);
    const maxElevation = Math.PI / 4; // 45 degrees max
    const clampedElevation = Math.max(-maxElevation, Math.min(maxElevation, elevationAngle));
    const y = radius * Math.sin(clampedElevation);
    
    // Set marker position
    destinationMarker.position.set(x, y, z);
    
    // Make marker always face the camera
    destinationMarker.lookAt(0, 0, 0);
    
    // Update marker label with distance
    updateMarkerLabel(Math.round(Math.sqrt(horizontalDistance * horizontalDistance + altitudeDiff * altitudeDiff)));
}

// Update marker label with distance
function updateMarkerLabel(distance) {
    if (!destinationMarker || destinationMarker.children.length < 4) return;
    
    const sprite = destinationMarker.children[3]; // The text sprite
    if (!sprite || !sprite.material || !sprite.material.map) return;
    
    // Create updated canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;
    
    // Draw background
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw border
    context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    context.lineWidth = 2;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    
    // Draw text
    context.font = 'bold 32px Arial';
    context.fillStyle = '#ff0000';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('DESTINATION', canvas.width / 2, canvas.height / 2 - 30);
    
    context.font = '24px Arial';
    context.fillStyle = 'white';
    context.fillText(`${distance}m away`, canvas.width / 2, canvas.height / 2 + 20);
    
    // Update texture
    sprite.material.map.image = canvas;
    sprite.material.map.needsUpdate = true;
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Add pulsing effect to destination marker
    if (destinationMarker) {
        const time = Date.now() * 0.005;
        const pulseRing = destinationMarker.children[1]; // The pulse ring
        if (pulseRing) {
            const scale = 1 + Math.sin(time) * 0.3;
            pulseRing.scale.set(scale, scale, scale);
            pulseRing.material.opacity = 0.2 + Math.sin(time * 2) * 0.1;
        }
    }
    
    renderer.render(scene, camera);
}
