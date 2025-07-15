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
const distanceDisplay = document.getElementById('distance-display');
const directionDisplay = document.getElementById('direction-display');
const orientationDisplay = document.getElementById('orientation-display');

// App state
let currentLocation = null;
let deviceOrientation = {
    alpha: 0,
    beta: 0,
    gamma: 0
};
let compassHeading = 0;

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
                updateDistanceAndDirection();
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
            updateDistanceAndDirection();
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
    
    console.log('Orientation listeners set up');
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
        console.warn('Orientation event with null values:', event);
        return;
    }
    
    // Apply smoothing to reduce jitter
    const smoothingFactor = 0.2;
    
    // Update orientation values with smoothing
    deviceOrientation.alpha = deviceOrientation.alpha + (event.alpha - deviceOrientation.alpha) * smoothingFactor;
    deviceOrientation.beta = deviceOrientation.beta + (event.beta - deviceOrientation.beta) * smoothingFactor;
    deviceOrientation.gamma = deviceOrientation.gamma + (event.gamma - deviceOrientation.gamma) * smoothingFactor;
    
    // Calculate compass heading
    let newCompassHeading;
    if (event.webkitCompassHeading) {
        // iOS Safari
        newCompassHeading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        // Android Chrome and others
        newCompassHeading = 360 - deviceOrientation.alpha;
    }
    
    // Apply smoothing to compass heading
    if (newCompassHeading !== undefined) {
        // Handle wrap-around for compass heading
        let diff = newCompassHeading - compassHeading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        
        compassHeading = (compassHeading + diff * smoothingFactor + 360) % 360;
    }
    
    // Log orientation data for debugging (limit to avoid spam)
    if (Math.random() < 0.01) { // Log ~1% of events
        console.log('Orientation:', {
            alpha: deviceOrientation.alpha.toFixed(1),
            beta: deviceOrientation.beta.toFixed(1),
            gamma: deviceOrientation.gamma.toFixed(1),
            compassHeading: compassHeading.toFixed(1)
        });
    }
    
    // Update marker position
    updateMarkerPosition();
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

// Update distance and direction displays
function updateDistanceAndDirection() {
    if (!currentLocation) return;
    
    // Calculate horizontal distance
    const distance = calculateDistance(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Calculate vertical distance (altitude difference)
    const altitudeDiff = TARGET.alt - (currentLocation.alt || 0);
    
    // Calculate total 3D distance using Pythagorean theorem
    const total3DDistance = Math.sqrt(distance * distance + altitudeDiff * altitudeDiff);
    
    // Calculate bearing (direction)
    const bearing = calculateBearing(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Update displays
    distanceDisplay.textContent = `Distance: ${Math.round(total3DDistance)} meters`;
    directionDisplay.textContent = `Direction: ${Math.round(bearing)}°`;
    orientationDisplay.textContent = `Compass: ${Math.round(compassHeading)}°`;
    
    // Update marker position if Three.js is initialized
    updateMarkerPosition();
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
    
    // Calculate bearing to target
    const bearing = calculateBearing(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Calculate the difference between our compass heading and the bearing
    let relativeBearing = bearing - compassHeading;
    
    // Normalize to -180 to 180 range
    while (relativeBearing > 180) relativeBearing -= 360;
    while (relativeBearing < -180) relativeBearing += 360;
    
    // Convert to radians
    const angleRad = (relativeBearing * Math.PI) / 180;
    
    // Calculate position in 3D space - closer to camera for better visibility
    const radius = 3; // Reduced from 5 for closer positioning
    const x = radius * Math.sin(angleRad);
    const z = -radius * Math.cos(angleRad);
    
    // Calculate y position based on altitude difference
    const altitudeDiff = TARGET.alt - (currentLocation.alt || 0);
    const distance = calculateDistance(
        currentLocation.lat, 
        currentLocation.lng, 
        TARGET.lat, 
        TARGET.lng
    );
    
    // Calculate elevation angle with dampening for smoother movement
    const elevationAngle = Math.atan2(altitudeDiff, distance);
    const maxElevation = Math.PI / 6; // Limit to 30 degrees up/down
    const clampedElevation = Math.max(-maxElevation, Math.min(maxElevation, elevationAngle));
    const y = radius * Math.sin(clampedElevation);
    
    // Apply smoothing to reduce jitter
    const smoothingFactor = 0.1;
    const currentPos = destinationMarker.position;
    const targetX = currentPos.x + (x - currentPos.x) * smoothingFactor;
    const targetY = currentPos.y + (y - currentPos.y) * smoothingFactor;
    const targetZ = currentPos.z + (z - currentPos.z) * smoothingFactor;
    
    // Set marker position
    destinationMarker.position.set(targetX, targetY, targetZ);
    
    // Make marker face the camera
    destinationMarker.lookAt(camera.position);
    
    // Log less frequently to reduce console spam
    if (Math.random() < 0.005) { // Log ~0.5% of updates
        console.log(`Marker position: x=${targetX.toFixed(2)}, y=${targetY.toFixed(2)}, z=${targetZ.toFixed(2)}, bearing=${bearing.toFixed(1)}°, relative=${relativeBearing.toFixed(1)}°`);
    }
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
