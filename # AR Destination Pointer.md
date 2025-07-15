# AR Destination Pointer

A web-based augmented reality application that shows the direction to a fixed geographical point using the device's camera, location, and orientation sensors.

## Features

- Uses device camera as a background
- Shows a 3D marker pointing to a specific destination
- Displays distance to the destination in meters
- Updates in real-time as you move and rotate your device

## Technologies Used

- Three.js for 3D rendering
- Web APIs for accessing device sensors:
  - Geolocation API
  - DeviceOrientation API
  - MediaDevices API (camera access)

## Usage

1. Open the application in a mobile browser
2. Grant permissions for camera, location, and device orientation
3. Point your phone in different directions to see the destination marker
4. The marker will adjust its position based on your orientation to always point toward the target

## Browser Compatibility

This application works best on:
- Chrome for Android
- Safari for iOS (iOS 13+ requires explicit permission for DeviceOrientation)

Some browsers may have limited support for certain sensor APIs.

## Development

To run this project locally:

1. Clone the repository
2. Serve the files using a local web server (due to security restrictions with camera access)
   