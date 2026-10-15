/**
 * ImageTool - Insert and manipulate images
 */
class ImageTool extends BaseTool {
    constructor(options = {}) {
        super('image', {
            ...options,
        });

        this.currentImage = null;
        this.isDragging = false;
        this.isResizing = false;
        this.dragStart = null;
        this.resizeHandle = null;

        // Supported formats
        this.supportedFormats = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

        // File input element
        this.fileInput = null;
        this.createFileInput();
    }

    /**
     * Create hidden file input
     */
    createFileInput() {
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = this.supportedFormats.join(',');
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        document.body.appendChild(this.fileInput);
    }

    /**
     * Handle pointer down
     */
    onPointerDown(pointerData) {
        if (!this.isActive) return;

        const x = pointerData.x;
        const y = pointerData.y;

        // Check if clicking on existing image
        const existingImage = this.findImageAt(x, y);

        if (existingImage) {
            this.selectImage(existingImage);

            // Check for resize handle
            const handle = this.getResizeHandle(existingImage, x, y);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle;
                this.dragStart = { x, y, image: { ...existingImage } };
            } else {
                this.isDragging = true;
                this.dragStart = { x, y, image: { ...existingImage } };
            }
        } else {
            // Open file picker to insert new image
            this.openFilePicker(x, y);
        }
    }

    /**
     * Handle pointer move
     */
    onPointerMove(data) {
        if (!this.isActive) return;

        const current = data.current;

        if (this.isDragging && this.currentImage) {
            const dx = current.x - this.dragStart.x;
            const dy = current.y - this.dragStart.y;

            this.currentImage.x = this.dragStart.image.x + dx;
            this.currentImage.y = this.dragStart.image.y + dy;

            this.drawImagePreview();
        } else if (this.isResizing && this.currentImage) {
            this.handleResize(current.x, current.y, data.shiftKey);
            this.drawImagePreview();
        }
    }

    /**
     * Handle pointer up
     */
    onPointerUp() {
        if (!this.isActive) return;

        if ((this.isDragging || this.isResizing) && this.currentImage) {
            // Update image on canvas
            CanvasManager.updateImage(this.currentImage);
            this.emit('imageUpdated', this.currentImage);
        }

        this.isDragging = false;
        this.isResizing = false;
        this.dragStart = null;
        this.resizeHandle = null;
    }

    /**
     * Open file picker
     */
    openFilePicker(x, y) {
        this.insertPosition = { x, y };
        this.fileInput.click();
    }

    /**
     * Handle file selection
     */
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        if (!this.supportedFormats.includes(file.type)) {
            this.emit('error', { message: 'Unsupported image format' });
            return;
        }

        try {
            const imageData = await this.loadImage(file);
            await this.insertImage(imageData);
        } catch (error) {
            console.error('Failed to load image:', error);
            this.emit('error', { message: 'Failed to load image' });
        }

        // Reset file input
        this.fileInput.value = '';
    }

    /**
     * Load image from file
     */
    loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    resolve({
                        element: img,
                        dataUrl: e.target.result,
                        width: img.width,
                        height: img.height,
                        name: file.name,
                    });
                };

                img.onerror = reject;
                img.src = e.target.result;
            };

            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Insert image at position
     */
    async insertImage(imageData) {
        // Scale image if too large
        let { width, height } = imageData;
        const maxSize = 800;

        if (width > maxSize || height > maxSize) {
            const scale = maxSize / Math.max(width, height);
            width *= scale;
            height *= scale;
        }

        const image = {
            id: `image_${Date.now()}`,
            type: 'image',
            x: this.insertPosition?.x || 100,
            y: this.insertPosition?.y || 100,
            width,
            height,
            originalWidth: imageData.width,
            originalHeight: imageData.height,
            dataUrl: imageData.dataUrl,
            name: imageData.name,
            rotation: 0,
            opacity: 1,
        };

        // Store image in IndexedDB
        await StorageManager.saveImage(image.id, imageData.dataUrl);

        // Add to canvas
        CanvasManager.addImage(image);

        this.currentImage = image;
        this.selectImage(image);

        this.emit('imageInserted', image);
    }

    /**
     * Select an image
     */
    selectImage(image) {
        this.currentImage = image;
        this.drawImagePreview();
        this.emit('imageSelected', image);
    }

    /**
     * Deselect image
     */
    deselectImage() {
        this.currentImage = null;
        RenderEngine.clearUI();
        this.emit('imageDeselected');
    }

    /**
     * Find image at position
     */
    findImageAt(x, y) {
        const images = CanvasManager.getImages();

        // Check in reverse order (top-most first)
        for (let i = images.length - 1; i >= 0; i--) {
            const img = images[i];
            if (x >= img.x && x <= img.x + img.width &&
                y >= img.y && y <= img.y + img.height) {
                return img;
            }
        }

        return null;
    }

    /**
     * Get resize handle at position
     */
    getResizeHandle(image, x, y) {
        const handleSize = 10;
        const handles = this.getHandlePositions(image);

        for (const [name, pos] of Object.entries(handles)) {
            if (Math.abs(x - pos.x) <= handleSize && Math.abs(y - pos.y) <= handleSize) {
                return name;
            }
        }

        return null;
    }

    /**
     * Get handle positions for an image
     */
    getHandlePositions(image) {
        return {
            'nw': { x: image.x, y: image.y },
            'n': { x: image.x + image.width / 2, y: image.y },
            'ne': { x: image.x + image.width, y: image.y },
            'e': { x: image.x + image.width, y: image.y + image.height / 2 },
            'se': { x: image.x + image.width, y: image.y + image.height },
            's': { x: image.x + image.width / 2, y: image.y + image.height },
            'sw': { x: image.x, y: image.y + image.height },
            'w': { x: image.x, y: image.y + image.height / 2 },
        };
    }

    /**
     * Handle resize
     */
    handleResize(x, y, maintainAspect) {
        if (!this.currentImage || !this.resizeHandle || !this.dragStart) return;

        const original = this.dragStart.image;
        const aspectRatio = original.width / original.height;

        switch (this.resizeHandle) {
            case 'se':
                this.currentImage.width = x - original.x;
                this.currentImage.height = y - original.y;
                break;
            case 'nw':
                this.currentImage.x = x;
                this.currentImage.y = y;
                this.currentImage.width = original.x + original.width - x;
                this.currentImage.height = original.y + original.height - y;
                break;
            case 'ne':
                this.currentImage.y = y;
                this.currentImage.width = x - original.x;
                this.currentImage.height = original.y + original.height - y;
                break;
            case 'sw':
                this.currentImage.x = x;
                this.currentImage.width = original.x + original.width - x;
                this.currentImage.height = y - original.y;
                break;
            case 'e':
                this.currentImage.width = x - original.x;
                break;
            case 'w':
                this.currentImage.x = x;
                this.currentImage.width = original.x + original.width - x;
                break;
            case 'n':
                this.currentImage.y = y;
                this.currentImage.height = original.y + original.height - y;
                break;
            case 's':
                this.currentImage.height = y - original.y;
                break;
        }

        // Maintain aspect ratio if shift is held
        if (maintainAspect) {
            if (this.resizeHandle.includes('e') || this.resizeHandle.includes('w')) {
                this.currentImage.height = this.currentImage.width / aspectRatio;
            } else {
                this.currentImage.width = this.currentImage.height * aspectRatio;
            }
        }

        // Minimum size
        this.currentImage.width = Math.max(50, this.currentImage.width);
        this.currentImage.height = Math.max(50, this.currentImage.height);
    }

    /**
     * Draw image preview with handles
     */
    drawImagePreview() {
        if (!this.currentImage) return;

        RenderEngine.clearUI();
        RenderEngine.drawUI((ctx) => {
            const img = this.currentImage;

            // Draw selection border
            ctx.strokeStyle = 'var(--accent-primary)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.strokeRect(img.x - 2, img.y - 2, img.width + 4, img.height + 4);
            ctx.setLineDash([]);

            // Draw handles
            const handles = this.getHandlePositions(img);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'var(--accent-primary)';

            for (const pos of Object.values(handles)) {
                ctx.beginPath();
                ctx.rect(pos.x - 5, pos.y - 5, 10, 10);
                ctx.fill();
                ctx.stroke();
            }
        });
    }

    /**
     * Delete selected image
     */
    deleteSelected() {
        if (this.currentImage) {
            CanvasManager.removeImage(this.currentImage.id);
            this.emit('imageDeleted', this.currentImage);
            this.deselectImage();
        }
    }

    /**
     * Rotate selected image
     */
    rotateSelected(degrees) {
        if (this.currentImage) {
            this.currentImage.rotation = (this.currentImage.rotation + degrees) % 360;
            CanvasManager.updateImage(this.currentImage);
            this.emit('imageRotated', this.currentImage);
        }
    }

    onDeactivate() {
        this.deselectImage();
    }

    getCursor() {
        return this.isDragging ? 'move' : 'default';
    }
}


/**
 * Render images on canvas
 */
class ImageRenderer {
    // Cache for loaded images
    static cache = new Map();

    /**
     * Render an image element
     */
    static async render(ctx, imageData) {
        const img = await ImageRenderer.getImage(imageData.dataUrl);
        if (!img) return;

        ctx.save();
        ctx.globalAlpha = imageData.opacity || 1;

        // Apply rotation
        if (imageData.rotation) {
            const cx = imageData.x + imageData.width / 2;
            const cy = imageData.y + imageData.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((imageData.rotation * Math.PI) / 180);
            ctx.translate(-cx, -cy);
        }

        ctx.drawImage(img, imageData.x, imageData.y, imageData.width, imageData.height);
        ctx.restore();
    }

    /**
     * Get image from cache or load
     */
    static getImage(dataUrl) {
        if (ImageRenderer.cache.has(dataUrl)) {
            return Promise.resolve(ImageRenderer.cache.get(dataUrl));
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                ImageRenderer.cache.set(dataUrl, img);
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = dataUrl;
        });
    }

    /**
     * Clear image cache
     */
    static clearCache() {
        ImageRenderer.cache.clear();
    }
}


// Make available globally
window.ImageTool = ImageTool;
window.ImageRenderer = ImageRenderer;
