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
    requestCameraAccess()
        .then(() => {
            loadingStatus.textContent = 'Camera access granted. Requesting location...';
            return requestLocationAccess();
        })
        .then(() => {
            loadingStatus.textContent = 'Location access granted. Requesting motion sensors...';
            return requestMotionAccess();
        })
        .then(() => {
            loadingStatus.textContent = 'All permissions granted. Initializing AR...';
            initThreeJS();
            loadingScreen.style.display = 'none';
        })
        .catch(error => {
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
                width: { ideal: window.innerWidth },
                height: { ideal: window.innerHeight }
            },
            audio: false
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        cameraFeed.srcObject = stream;
        return new Promise((resolve) => {
            cameraFeed.onloadedmetadata = () => {
                resolve();
            };
        });
    } catch (error) {
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
        
        navigator.geolocation.watchPosition(
            position => {
                currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    alt: position.coords.altitude || 0
                };
                updateDistanceAndDirection();
                resolve();
            },
            error => {
                reject(new Error(`Location access denied: ${error.message}`));
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
    });
}

// Request device motion and orientation access
async function requestMotionAccess() {
    return new Promise((resolve, reject) => {
        // For iOS 13+ which requires permission for DeviceOrientation
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            
            DeviceOrientationEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        window.addEventListener('deviceorientation', handleOrientation);
                        resolve();
                    } else {
                        reject(new Error('Motion sensors access denied'));
                    }
                })
                .catch(reject);
        } else {
            // For other browsers that don't need explicit permission
            window.addEventListener('deviceorientation', handleOrientation);
            
            // Check if we're getting orientation data after a short delay
            setTimeout(() => {
                if (deviceOrientation.alpha === 0 && 
                    deviceOrientation.beta === 0 && 
                    deviceOrientation.gamma === 0) {
                    console.warn('No orientation data received, but continuing anyway');
                }
                resolve();
            }, 1000);
        }
    });
}

// Handle device orientation changes
function handleOrientation(event) {
    // Update orientation values
    deviceOrientation.alpha = event.alpha || 0; // Compass direction (0-360)
    deviceOrientation.beta = event.beta || 0;   // Front/back tilt (-180-180)
    deviceOrientation.gamma = event.gamma || 0; // Left/right tilt (-90-90)
    
    // For devices that provide compass heading directly
    if (event.webkitCompassHeading) {
        compassHeading = event.webkitCompassHeading;
    } else {
        compassHeading = 360 - deviceOrientation.alpha;
    }
    
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
    
    // Update marker position if Three.js is initialized
    updateMarkerPosition();
}

// Initialize Three.js scene
function initThreeJS() {
    // Create scene
    scene = new THREE.Scene();
    
    // Create camera (perspective)
    const fov = 75;
    const aspect = window.innerWidth / window.innerHeight;
    const near = 0.1;
    const far = 1000;
    camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.z = 5;
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({
        canvas: arOverlay,
        alpha: true // Transparent background
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Create destination marker (red sphere)
    const geometry = new THREE.SphereGeometry(0.5, 32, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    destinationMarker = new THREE.Mesh(geometry, material);
    scene.add(destinationMarker);
    
    // Add text to the marker
    createMarkerLabel();
    
    // Initialize raycaster for pointer calculations
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
}

// Create text label for the destination marker
function createMarkerLabel() {
    // Create a canvas for the text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;
    
    // Draw background
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw text
    context.font = 'bold 24px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('DESTINATION', canvas.width / 2, canvas.height / 2 - 15);
    context.font = '18px Arial';
    context.fillText('Tap to navigate', canvas.width / 2, canvas.height / 2 + 15);
    
    // Create texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    
    // Create sprite material
    const material = new THREE.SpriteMaterial({ map: texture });
    
    // Create sprite and add to destination marker
    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 1, 0); // Position above the sphere
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
    const relativeBearing = (bearing - compassHeading + 360) % 360;
    
    // Convert to radians
    const angleRad = relativeBearing * Math.PI / 180;
    
    // Calculate position in 3D space
    // We place the marker on a virtual sphere around the camera
    const radius = 10;
    const x = radius * Math.sin(angleRad);
    const z = -radius * Math.cos(angleRad);
    
    // Adjust y position based on altitude difference
    const altitudeDiff = TARGET.alt - (currentLocation.alt || 0);
    // Normalize altitude difference to a reasonable screen position
    const maxAltitudeDiff = 1000; // 1000 meters max for normalization
    const normalizedAltDiff = Math.max(-1, Math.min(1, altitudeDiff / maxAltitudeDiff));
    const y = normalizedAltDiff * 5; // Scale to scene coordinates
    
    // Set marker position
    destinationMarker.position.set(x, y, z);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
