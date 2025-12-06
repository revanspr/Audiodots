// Canvas and video setup
const video = document.getElementById('video');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const displayCanvas = document.getElementById('displayCanvas');
const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const displayCtx = displayCanvas.getContext('2d');

// Set canvas sizes
const WIDTH = 640;
const HEIGHT = 480;
hiddenCanvas.width = WIDTH;
hiddenCanvas.height = HEIGHT;
displayCanvas.width = WIDTH;
displayCanvas.height = HEIGHT;

// Audio context
let audioContext;
let masterGain;
let isAudioStarted = false;
let isPaused = false;

// Configuration
const NUM_DOTS = 230;
const CONNECTIONS_PER_DOT = 9;
const NUM_COLORS = 23;
const COLORS_TO_USE = 10;
const DOT_RADIUS = 3;

// Define 23 distinct colors (HSL for vibrant colors)
const ALL_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
    '#E63946', '#A8DADC', '#457B9D', '#F4A261', '#2A9D8F',
    '#E76F51', '#8338EC', '#FB5607', '#FFBE0B', '#3A86FF',
    '#06FFA5', '#FF006E', '#8338EC'
];

// Randomly select 10 colors from the 23
const SELECTED_COLORS = [];
const colorIndices = [];
while (colorIndices.length < COLORS_TO_USE) {
    const randomIndex = Math.floor(Math.random() * NUM_COLORS);
    if (!colorIndices.includes(randomIndex)) {
        colorIndices.push(randomIndex);
        SELECTED_COLORS.push(ALL_COLORS[randomIndex]);
    }
}

// Dot class
class Dot {
    constructor(index, x, y, color) {
        this.index = index;
        this.x = x;
        this.y = y;
        this.targetX = x;
        this.targetY = y;
        this.color = color;
        this.connections = []; // Will store indices of connected dots
        this.radius = DOT_RADIUS;
    }

    update() {
        // Smooth movement towards target position
        const smoothing = 0.15;
        this.x += (this.targetX - this.x) * smoothing;
        this.y += (this.targetY - this.y) * smoothing;
    }

    draw() {
        displayCtx.beginPath();
        displayCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        displayCtx.fillStyle = this.color;
        displayCtx.fill();

        // Glow effect
        displayCtx.shadowBlur = 8;
        displayCtx.shadowColor = this.color;
        displayCtx.fill();
        displayCtx.shadowBlur = 0;
    }
}

// Connection class with audio
class Connection {
    constructor(dot1, dot2, index) {
        this.dot1 = dot1;
        this.dot2 = dot2;
        this.index = index;
        this.initialDistance = this.getDistance();
        this.currentDistance = this.initialDistance;

        // Audio properties
        this.oscillator = null;
        this.gainNode = null;
        this.baseFrequency = 200 + (index % 50) * 20; // Vary base frequencies
    }

    getDistance() {
        const dx = this.dot1.x - this.dot2.x;
        const dy = this.dot1.y - this.dot2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    update() {
        this.currentDistance = this.getDistance();
    }

    draw() {
        displayCtx.beginPath();
        displayCtx.moveTo(this.dot1.x, this.dot1.y);
        displayCtx.lineTo(this.dot2.x, this.dot2.y);

        // Line color based on distance change
        const distanceRatio = this.currentDistance / Math.max(this.initialDistance, 1);
        const alpha = Math.min(0.4, 0.2 + Math.abs(1 - distanceRatio) * 0.5);
        displayCtx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
        displayCtx.lineWidth = 1;
        displayCtx.stroke();
    }

    startSound() {
        if (!audioContext || this.oscillator) return;

        this.oscillator = audioContext.createOscillator();
        this.gainNode = audioContext.createGain();

        this.oscillator.type = 'sine';
        this.oscillator.frequency.setValueAtTime(this.baseFrequency, audioContext.currentTime);
        this.gainNode.gain.setValueAtTime(0, audioContext.currentTime);

        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(masterGain);

        this.oscillator.start();
    }

    updateSound(volumeLevel) {
        if (!this.oscillator || !this.gainNode || isPaused) return;

        // Calculate frequency based on distance
        // Shorter line = higher pitch, longer line = lower pitch
        const distanceRatio = this.currentDistance / Math.max(this.initialDistance, 1);
        const frequency = this.baseFrequency * (2.5 - distanceRatio * 1.5);

        // Volume based on how much the distance has changed
        const changeAmount = Math.abs(1 - distanceRatio);
        const targetVolume = Math.min(0.02, changeAmount * 0.05) * volumeLevel;

        this.oscillator.frequency.setTargetAtTime(
            Math.max(100, Math.min(2000, frequency)),
            audioContext.currentTime,
            0.02
        );
        this.gainNode.gain.setTargetAtTime(targetVolume, audioContext.currentTime, 0.02);
    }

    stopSound() {
        if (!this.oscillator) return;

        this.gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);

        setTimeout(() => {
            if (this.oscillator) {
                this.oscillator.stop();
                this.oscillator.disconnect();
                this.gainNode.disconnect();
                this.oscillator = null;
                this.gainNode = null;
            }
        }, 100);
    }
}

// Initialize dots and connections
let dots = [];
let connections = [];

function initDots() {
    dots = [];
    connections = [];

    // Create dots distributed across the canvas initially
    for (let i = 0; i < NUM_DOTS; i++) {
        const x = (i % 20) * (WIDTH / 20) + WIDTH / 40;
        const y = Math.floor(i / 20) * (HEIGHT / 12) + HEIGHT / 24;
        const colorIndex = i % COLORS_TO_USE;
        const color = SELECTED_COLORS[colorIndex];

        dots.push(new Dot(i, x, y, color));
    }

    // Create connections - each dot connects to 9 random other dots
    const usedConnections = new Set();

    for (let i = 0; i < NUM_DOTS; i++) {
        const dot = dots[i];
        const availableDots = [...Array(NUM_DOTS).keys()].filter(idx => idx !== i);

        // Shuffle and pick 9 random dots
        for (let j = 0; j < CONNECTIONS_PER_DOT && availableDots.length > 0; j++) {
            const randomIndex = Math.floor(Math.random() * availableDots.length);
            const targetDotIndex = availableDots[randomIndex];
            availableDots.splice(randomIndex, 1);

            // Create unique connection ID to avoid duplicates
            const connectionId = i < targetDotIndex
                ? `${i}-${targetDotIndex}`
                : `${targetDotIndex}-${i}`;

            if (!usedConnections.has(connectionId)) {
                usedConnections.add(connectionId);
                dot.connections.push(targetDotIndex);
                const connection = new Connection(dot, dots[targetDotIndex], connections.length);
                connections.push(connection);
            }
        }
    }

    document.getElementById('connectionCount').textContent = connections.length;
}

// Camera setup
async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: WIDTH,
                height: HEIGHT,
                facingMode: 'user'
            },
            audio: false
        });

        video.srcObject = stream;

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve(video);
            };
        });
    } catch (err) {
        console.error('Error accessing camera:', err);
        document.getElementById('status').textContent = 'Camera access denied. Please allow camera access.';
        throw err;
    }
}

// Detect hand using skin tone detection and edge detection
let sensitivity = 50;

function detectOutline() {
    // Draw video frame to hidden canvas
    hiddenCtx.drawImage(video, 0, 0, WIDTH, HEIGHT);
    const imageData = hiddenCtx.getImageData(0, 0, WIDTH, HEIGHT);
    const data = imageData.data;

    // Skin tone detection - find hand region
    const handPixels = [];
    const step = 4; // Sample every 4th pixel for performance

    for (let y = step; y < HEIGHT - step; y += step) {
        for (let x = step; x < WIDTH - step; x += step) {
            const idx = (y * WIDTH + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            // Skin tone detection (works for various skin tones)
            // Check if pixel falls within skin tone range
            if (isSkinTone(r, g, b)) {
                handPixels.push({ x, y, brightness: (r + g + b) / 3 });
            }
        }
    }

    // Find hand outline from skin tone pixels using edge detection
    const outlinePoints = [];

    for (let i = 0; i < handPixels.length; i++) {
        const pixel = handPixels[i];
        const x = pixel.x;
        const y = pixel.y;

        // Check if this pixel is on the edge (has non-skin neighbors)
        const idx = (y * WIDTH + x) * 4;
        let isEdge = false;

        // Check surrounding pixels
        for (let dy = -step; dy <= step; dy += step) {
            for (let dx = -step; dx <= step; dx += step) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;

                if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT) {
                    const nIdx = (ny * WIDTH + nx) * 4;
                    const nr = data[nIdx];
                    const ng = data[nIdx + 1];
                    const nb = data[nIdx + 2];

                    if (!isSkinTone(nr, ng, nb)) {
                        isEdge = true;
                        break;
                    }
                }
            }
            if (isEdge) break;
        }

        if (isEdge) {
            outlinePoints.push({ x, y });
        }
    }

    return outlinePoints;
}

// Detect skin tone (optimized for hand detection)
function isSkinTone(r, g, b) {
    // Multiple skin tone detection methods for better accuracy

    // Method 1: RGB thresholds (covers wide range of skin tones)
    const rgbCheck = r > 95 && g > 40 && b > 20 &&
                     r > g && r > b &&
                     Math.abs(r - g) > 15;

    // Method 2: Normalized RGB
    const sum = r + g + b;
    if (sum === 0) return false;

    const nr = r / sum;
    const ng = g / sum;

    const normalizedCheck = nr > 0.36 && nr < 0.465 &&
                           ng > 0.28 && ng < 0.363;

    // Method 3: YCbCr color space approximation
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = -0.169 * r - 0.331 * g + 0.5 * b + 128;
    const cr = 0.5 * r - 0.419 * g - 0.081 * b + 128;

    const ycbcrCheck = y > 80 &&
                      cb >= 77 && cb <= 127 &&
                      cr >= 133 && cr <= 173;

    return rgbCheck || normalizedCheck || ycbcrCheck;
}

// Map dots to outline points
function mapDotsToOutline(outlinePoints) {
    if (outlinePoints.length === 0) return;

    // Distribute dots across outline points
    for (let i = 0; i < NUM_DOTS; i++) {
        if (outlinePoints.length > 0) {
            const pointIndex = Math.floor((i / NUM_DOTS) * outlinePoints.length);
            const point = outlinePoints[pointIndex % outlinePoints.length];
            dots[i].targetX = point.x;
            dots[i].targetY = point.y;
        }
    }
}

// Audio initialization
function initAudio() {
    if (isAudioStarted) return;

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0.3, audioContext.currentTime);
    masterGain.connect(audioContext.destination);

    isAudioStarted = true;

    // Start oscillators for all connections
    connections.forEach(conn => conn.startSound());
}

// Animation loop
let volumeLevel = 0.3;

function animate() {
    // Clear canvas
    displayCtx.fillStyle = '#000';
    displayCtx.fillRect(0, 0, WIDTH, HEIGHT);

    // Detect outline and map dots
    const outlinePoints = detectOutline();
    mapDotsToOutline(outlinePoints);

    // Update and draw connections
    connections.forEach(conn => {
        conn.update();
        conn.draw();
        if (isAudioStarted) {
            conn.updateSound(volumeLevel);
        }
    });

    // Update and draw dots
    dots.forEach(dot => {
        dot.update();
        dot.draw();
    });

    // Update active sounds count
    if (isAudioStarted) {
        document.getElementById('soundCount').textContent = connections.length;
    }

    requestAnimationFrame(animate);
}

// Controls
document.getElementById('startBtn').addEventListener('click', async () => {
    try {
        document.getElementById('status').textContent = 'Initializing camera...';
        await setupCamera();

        document.getElementById('status').textContent = 'Initializing dots and audio...';
        initDots();
        initAudio();

        document.getElementById('status').textContent = 'Running - Show your hand to the camera!';
        document.getElementById('startBtn').disabled = true;
        document.getElementById('pauseBtn').disabled = false;

        animate();
    } catch (err) {
        document.getElementById('status').textContent = 'Error: ' + err.message;
    }
});

document.getElementById('pauseBtn').addEventListener('click', () => {
    isPaused = !isPaused;
    document.getElementById('pauseBtn').textContent = isPaused ? 'Resume Audio' : 'Pause Audio';

    if (isPaused) {
        connections.forEach(conn => {
            if (conn.gainNode) {
                conn.gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.01);
            }
        });
    }
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
    volumeLevel = e.target.value / 100;
    document.getElementById('volumeValue').textContent = e.target.value;

    if (masterGain) {
        masterGain.gain.setValueAtTime(volumeLevel, audioContext.currentTime);
    }
});

document.getElementById('sensitivitySlider').addEventListener('input', (e) => {
    sensitivity = parseInt(e.target.value);
    document.getElementById('sensitivityValue').textContent = e.target.value;
});

// Initialize
console.log('Audiodots initialized. Click "Start Camera & Audio" to begin.');
