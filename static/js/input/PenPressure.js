/**
 * PenPressure - Advanced pressure and tilt handling for stylus input
 * Supports 4096 pressure levels and tilt-based brush effects
 */
class PenPressure extends EventEmitter {
    constructor() {
        super();

        // Pressure configuration
        this.config = {
            // Pressure levels (4096 for professional styluses)
            pressureLevels: 4096,

            // Pressure curve (adjusts feel)
            pressureCurve: 'linear', // 'linear', 'soft', 'firm', 'custom'
            customCurve: null,

            // Sensitivity multiplier (0-2)
            sensitivity: 1.0,

            // Minimum and maximum pressure thresholds
            minPressure: 0.0,
            maxPressure: 1.0,

            // Initial pressure (for pressure ramp-up)
            initialPressure: 0.1,
            initialPressureFrames: 3,
        };

        // Tilt configuration
        this.tiltConfig = {
            enabled: true,
            sensitivity: 1.0,
            maxAngle: 90, // degrees

            // Tilt effects
            affectsWidth: true,
            affectsOpacity: false,
            affectsRotation: true,
        };

        // Smoothing for jitter reduction
        // PERFORMANCE: Use circular buffer instead of array shift
        this.smoothing = {
            enabled: true,
            factor: 0.3, // 0-1, higher = smoother but more latency
            pressureHistory: new Float32Array(8), // Pre-allocated typed array
            historyIndex: 0,
            historyCount: 0,
            historySize: 5,
        };

        // State tracking
        this.state = {
            rawPressure: 0,
            smoothedPressure: 0,
            quantizedPressure: 0,
            tiltX: 0,
            tiltY: 0,
            tiltMagnitude: 0,
            tiltAngle: 0,
            twist: 0,
            frameCount: 0,
        };

        // Pressure curve functions
        this.curves = {
            linear: p => p,
            soft: p => Math.pow(p, 0.5),
            firm: p => Math.pow(p, 2),
            sCurve: p => p < 0.5
                ? 2 * Math.pow(p, 2)
                : 1 - Math.pow(-2 * p + 2, 2) / 2,
        };
    }

    /**
     * Initialize with settings
     * @param {Object} settings - Configuration options
     */
    init(settings = {}) {
        Object.assign(this.config, settings.pressure || {});
        Object.assign(this.tiltConfig, settings.tilt || {});
        Object.assign(this.smoothing, settings.smoothing || {});

        this.emit('initialized');
    }

    /**
     * Process raw pointer input and extract pressure/tilt data
     * @param {Object} pointerData - Raw pointer event data
     * @returns {Object} Processed pressure and tilt data
     */
    process(pointerData) {
        // Update frame count for initial pressure handling
        if (pointerData.pressure > 0) {
            this.state.frameCount++;
        } else {
            this.state.frameCount = 0;
        }

        // Process pressure
        const pressure = this._processPressure(pointerData.pressure);

        // Process tilt
        const tilt = this._processTilt(pointerData.tiltX, pointerData.tiltY);

        // Process twist (barrel rotation)
        const twist = pointerData.twist || 0;

        // Calculate derived values
        const result = {
            // Pressure values
            rawPressure: pointerData.pressure,
            pressure: pressure.final,
            quantizedPressure: pressure.quantized,
            pressureLevel: pressure.level,

            // Tilt values
            tiltX: tilt.x,
            tiltY: tilt.y,
            tiltMagnitude: tilt.magnitude,
            tiltAngle: tilt.angle,

            // Twist value
            twist: twist,

            // Calculated effects
            widthMultiplier: this._calculateWidthMultiplier(pressure.final, tilt),
            opacityMultiplier: this._calculateOpacityMultiplier(pressure.final, tilt),
            rotation: this._calculateRotation(tilt, twist),
        };

        // Update state
        this.state = {
            ...this.state,
            rawPressure: pointerData.pressure,
            smoothedPressure: pressure.final,
            quantizedPressure: pressure.quantized,
            tiltX: tilt.x,
            tiltY: tilt.y,
            tiltMagnitude: tilt.magnitude,
            tiltAngle: tilt.angle,
            twist: twist,
        };

        return result;
    }

    /**
     * Process pressure value
     * @param {number} rawPressure - Raw pressure (0-1)
     * @returns {Object} Processed pressure data
     */
    _processPressure(rawPressure) {
        let pressure = rawPressure;

        // Handle initial pressure ramp-up
        if (this.state.frameCount <= this.config.initialPressureFrames) {
            const rampFactor = this.state.frameCount / this.config.initialPressureFrames;
            pressure = Math.max(pressure, this.config.initialPressure * rampFactor);
        }

        // Apply thresholds
        pressure = Math.max(this.config.minPressure,
                          Math.min(this.config.maxPressure, pressure));

        // Normalize to 0-1 range based on thresholds
        pressure = (pressure - this.config.minPressure) /
                  (this.config.maxPressure - this.config.minPressure);

        // Apply sensitivity
        pressure *= this.config.sensitivity;
        pressure = Math.min(1, Math.max(0, pressure));

        // Apply pressure curve
        pressure = this._applyCurve(pressure);

        // Apply smoothing
        if (this.smoothing.enabled) {
            pressure = this._smooth(pressure);
        }

        // Quantize to 4096 levels
        const level = Math.round(pressure * (this.config.pressureLevels - 1));
        const quantized = level / (this.config.pressureLevels - 1);

        return {
            final: pressure,
            quantized: quantized,
            level: level,
        };
    }

    /**
     * Apply pressure curve
     * @param {number} pressure - Input pressure (0-1)
     * @returns {number} Curved pressure
     */
    _applyCurve(pressure) {
        if (this.config.pressureCurve === 'custom' && this.config.customCurve) {
            return this.config.customCurve(pressure);
        }

        const curveFn = this.curves[this.config.pressureCurve] || this.curves.linear;
        return curveFn(pressure);
    }

    /**
     * Smooth pressure values
     * PERFORMANCE: Uses circular buffer to avoid array shift operations
     * @param {number} pressure - Current pressure
     * @returns {number} Smoothed pressure
     */
    _smooth(pressure) {
        const s = this.smoothing;

        // Add to circular buffer
        s.pressureHistory[s.historyIndex] = pressure;
        s.historyIndex = (s.historyIndex + 1) % s.historySize;
        if (s.historyCount < s.historySize) s.historyCount++;

        if (s.historyCount === 0) return pressure;

        // Calculate weighted average using circular buffer
        let weightedSum = 0;
        let weightSum = 0;
        const count = s.historyCount;

        for (let i = 0; i < count; i++) {
            // Read from circular buffer in order (oldest to newest)
            const idx = (s.historyIndex - count + i + s.historySize) % s.historySize;
            const weight = (i + 1) / count; // More recent = higher weight
            weightedSum += s.pressureHistory[idx] * weight;
            weightSum += weight;
        }

        const smoothed = weightedSum / weightSum;

        // Blend with current value based on smoothing factor
        return pressure * (1 - s.factor) + smoothed * s.factor;
    }

    /**
     * Process tilt values
     * @param {number} tiltX - X-axis tilt (-90 to 90)
     * @param {number} tiltY - Y-axis tilt (-90 to 90)
     * @returns {Object} Processed tilt data
     */
    _processTilt(tiltX, tiltY) {
        if (!this.tiltConfig.enabled) {
            return { x: 0, y: 0, magnitude: 0, angle: 0 };
        }

        // Normalize to -1 to 1 range
        const x = (tiltX / this.tiltConfig.maxAngle) * this.tiltConfig.sensitivity;
        const y = (tiltY / this.tiltConfig.maxAngle) * this.tiltConfig.sensitivity;

        // Clamp values
        const clampedX = Math.max(-1, Math.min(1, x));
        const clampedY = Math.max(-1, Math.min(1, y));

        // Calculate magnitude (0-1)
        const magnitude = Math.min(1, Math.sqrt(clampedX * clampedX + clampedY * clampedY));

        // Calculate angle (radians)
        const angle = Math.atan2(clampedY, clampedX);

        return {
            x: clampedX,
            y: clampedY,
            magnitude: magnitude,
            angle: angle,
        };
    }

    /**
     * Calculate width multiplier based on pressure and tilt
     * @param {number} pressure - Processed pressure
     * @param {Object} tilt - Tilt data
     * @returns {number} Width multiplier
     */
    _calculateWidthMultiplier(pressure, tilt) {
        let multiplier = pressure;

        if (this.tiltConfig.enabled && this.tiltConfig.affectsWidth) {
            // Tilt can increase width (like a calligraphy brush)
            multiplier *= (1 + tilt.magnitude * 0.5);
        }

        return Math.max(0.1, Math.min(2, multiplier));
    }

    /**
     * Calculate opacity multiplier based on pressure and tilt
     * @param {number} pressure - Processed pressure
     * @param {Object} tilt - Tilt data
     * @returns {number} Opacity multiplier
     */
    _calculateOpacityMultiplier(pressure, tilt) {
        let multiplier = 1;

        if (this.tiltConfig.enabled && this.tiltConfig.affectsOpacity) {
            multiplier *= (1 - tilt.magnitude * 0.3);
        }

        // Pressure affects opacity for some brush types
        multiplier *= (0.5 + pressure * 0.5);

        return Math.max(0.1, Math.min(1, multiplier));
    }

    /**
     * Calculate brush rotation based on tilt and twist
     * @param {Object} tilt - Tilt data
     * @param {number} twist - Barrel twist
     * @returns {number} Rotation angle (radians)
     */
    _calculateRotation(tilt, twist) {
        if (!this.tiltConfig.enabled || !this.tiltConfig.affectsRotation) {
            return 0;
        }

        // Combine tilt angle and barrel twist
        let rotation = tilt.angle;

        if (twist !== 0) {
            rotation = (twist * Math.PI) / 180; // Convert to radians
        }

        return rotation;
    }

    /**
     * Reset smoothing history
     */
    reset() {
        this.smoothing.pressureHistory = [];
        this.state.frameCount = 0;
    }

    /**
     * Set pressure curve
     * @param {string|Function} curve - Curve name or custom function
     */
    setCurve(curve) {
        if (typeof curve === 'function') {
            this.config.pressureCurve = 'custom';
            this.config.customCurve = curve;
        } else {
            this.config.pressureCurve = curve;
            this.config.customCurve = null;
        }
    }

    /**
     * Set sensitivity
     * @param {number} value - Sensitivity (0-2)
     */
    setSensitivity(value) {
        this.config.sensitivity = Math.max(0, Math.min(2, value));
    }

    /**
     * Set tilt enabled
     * @param {boolean} enabled
     */
    setTiltEnabled(enabled) {
        this.tiltConfig.enabled = enabled;
    }

    /**
     * Get current pressure state
     * @returns {Object} Current state
     */
    getState() {
        return { ...this.state };
    }

    /**
     * Get pressure level (0-4095)
     * @returns {number}
     */
    getPressureLevel() {
        return Math.round(this.state.smoothedPressure * (this.config.pressureLevels - 1));
    }

    /**
     * Create a bezier curve for pressure response
     * @param {number} p1 - Control point 1 (0-1)
     * @param {number} p2 - Control point 2 (0-1)
     * @returns {Function} Curve function
     */
    static createBezierCurve(p1, p2) {
        return (t) => {
            const oneMinusT = 1 - t;
            return 3 * oneMinusT * oneMinusT * t * p1 +
                   3 * oneMinusT * t * t * p2 +
                   t * t * t;
        };
    }
}

// Global pen pressure instance
window.PenPressure = new PenPressure();
