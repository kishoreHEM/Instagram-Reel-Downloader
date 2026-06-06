class InstaReelDownloader {
    constructor() {
        this.videoUrlInput = document.getElementById('videoUrl');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.resultsSection = document.getElementById('resultsSection');
        this.videoPreview = document.getElementById('videoPreview');
        this.downloadOptions = document.getElementById('downloadOptions');
        this.apiBaseUrl = this.getApiBaseUrl();
        
        this.init();
    }
    
    init() {
        this.downloadBtn.addEventListener('click', () => this.handleDownload());
        this.videoUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleDownload();
            }
        });
        
        // Clear input on page load for better mobile UX
        this.videoUrlInput.value = '';
        this.videoUrlInput.focus();
        
        // Add input validation
        this.videoUrlInput.addEventListener('input', () => {
            this.clearError();
        });
    }
    
    validateInstagramUrl(url) {
        try {
            const parsed = new URL(url.trim());
            const allowedHosts = ['instagram.com', 'www.instagram.com', 'm.instagram.com'];
            const allowedPath = /^\/(reel|reels|p|tv)\/[A-Za-z0-9_.-]+\/?$/i;

            return ['http:', 'https:'].includes(parsed.protocol)
                && allowedHosts.includes(parsed.hostname.toLowerCase())
                && allowedPath.test(parsed.pathname);
        } catch (error) {
            return false;
        }
    }

    getApiBaseUrl() {
        const localHosts = ['127.0.0.1', 'localhost', '::1'];
        const isLocalStaticServer = localHosts.includes(window.location.hostname)
            && window.location.port
            && window.location.port !== '3000';

        return isLocalStaticServer ? `${window.location.protocol}//${window.location.hostname}:3000` : '';
    }

    apiUrl(path) {
        return `${this.apiBaseUrl}${path}`;
    }
    
    async handleDownload() {
        const url = this.videoUrlInput.value.trim();
        
        if (!url) {
            this.showError('Please enter an Instagram URL');
            return;
        }
        
        if (!this.validateInstagramUrl(url)) {
            this.showError('Please enter a valid public Instagram video URL\n\nSupported formats:\n• https://www.instagram.com/reel/ABC123...\n• https://www.instagram.com/p/XYZ789...\n• https://www.instagram.com/tv/...');
            return;
        }
        
        this.setLoadingState(true);
        this.hideResults();
        this.clearError();
        
        try {
            const videoData = await this.processVideo(url);
            this.showResults(videoData);
            this.showSuccess('Video ready. Choose a download option below.');
        } catch (error) {
            this.showError(error.message || 'Failed to process reel. Please check the URL and try again.');
            console.error('Error:', error);
        } finally {
            this.setLoadingState(false);
        }
    }
    
    async processVideo(url) {
        // Show loading progress
        this.showProgress('Processing reel...', 30);

        let response;

        try {
            response = await fetch(this.apiUrl(`/api/resolve?url=${encodeURIComponent(url)}`));
        } catch (error) {
            throw new Error('Backend server is not running. Run npm start, then open http://127.0.0.1:3000/ or keep the backend running while using Live Server.');
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('The frontend is reaching a static page instead of the backend API. Run npm start and use http://127.0.0.1:3000/, or keep the backend running on port 3000 when using Live Server.');
        }

        const videoData = await response.json();

        this.showProgress('Preparing download...', 90);

        if (!response.ok || !videoData.success) {
            throw new Error(videoData.error || 'Could not extract this Instagram video.');
        }

        return videoData;
    }
    
    showProgress(message, percent) {
        // This would update a progress bar in a real implementation
        console.log(`${message} (${percent}%)`);
    }
    
    setLoadingState(loading) {
        const btnText = this.downloadBtn.querySelector('.btn-text');
        const btnLoading = this.downloadBtn.querySelector('.btn-loading');
        
        if (loading) {
            btnText.style.display = 'none';
            btnLoading.style.display = 'flex';
            this.downloadBtn.disabled = true;
            this.downloadBtn.style.opacity = '0.8';
        } else {
            btnText.style.display = 'flex';
            btnLoading.style.display = 'none';
            this.downloadBtn.disabled = false;
            this.downloadBtn.style.opacity = '1';
        }
    }
    
    showResults(videoData) {
        if (!videoData.success) {
            throw new Error(videoData.error || 'Processing failed');
        }

        const safeTitle = this.escapeHtml(videoData.title || 'Instagram video');
        const safeUploader = this.escapeHtml(videoData.uploader || '');
        const thumbnailUrl = videoData.thumbnail
            ? this.apiUrl(`/api/thumbnail?url=${encodeURIComponent(videoData.thumbnail)}`)
            : '';
        const safeThumbnail = this.escapeAttribute(thumbnailUrl);

        // Create video preview
        this.videoPreview.innerHTML = `
            <div class="result-card">
                <div class="video-thumb-shell">
                    ${safeThumbnail ? `<img src="${safeThumbnail}" alt="${safeTitle}" class="video-thumbnail-img">` : ''}
                    <div class="video-thumbnail-fallback ${safeThumbnail ? 'is-hidden' : ''}">
                        <span class="fallback-icon">▶</span>
                        <span>Preview unavailable</span>
                    </div>
                </div>
                <div class="video-meta">
                    <h3>${safeTitle}</h3>
                    ${safeUploader ? `<p>${safeUploader}</p>` : '<p>Public Instagram video</p>'}
                </div>
            </div>
        `;

        const thumbnailImg = this.videoPreview.querySelector('.video-thumbnail-img');
        const thumbnailFallback = this.videoPreview.querySelector('.video-thumbnail-fallback');
        if (thumbnailImg && thumbnailFallback) {
            thumbnailImg.addEventListener('load', () => {
                thumbnailFallback.classList.add('is-hidden');
            });
            thumbnailImg.addEventListener('error', () => {
                thumbnailImg.remove();
                thumbnailFallback.classList.remove('is-hidden');
            });
        }
        
        // Create download buttons
        this.downloadOptions.innerHTML = videoData.formats.map((format) => {
            const downloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(videoData.sourceUrl)}&format_id=${encodeURIComponent(format.formatId)}&filename=${encodeURIComponent(videoData.filename || 'instagram-video')}`);
            const quality = this.escapeHtml(format.quality || 'Best');
            const size = this.escapeHtml(format.size || 'Unknown size');
            const fileFormat = this.escapeHtml(format.format || 'MP4');
            const qualityClass = this.escapeAttribute(format.quality || 'best').toLowerCase();

            return `
            <a href="${downloadUrl}"
               class="download-option-btn ${qualityClass}">
                <span class="download-icon" aria-hidden="true">↓</span>
                <span class="download-info">
                    <strong>Download ${quality}</strong>
                    <small>${size} - ${fileFormat}</small>
                </span>
            </a>
        `;
        }).join('');
        
        // Show results section with animation
        this.resultsSection.style.display = 'block';
        setTimeout(() => {
            this.resultsSection.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 100);
    }
    
    hideResults() {
        this.resultsSection.style.display = 'none';
    }
    
    showError(message) {
        this.clearError();
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = message.replace(/\n/g, '<br>');
        errorDiv.style.whiteSpace = 'pre-line';
        
        const downloadForm = document.querySelector('.download-form');
        downloadForm.parentNode.insertBefore(errorDiv, downloadForm.nextSibling);
        
        // Auto-remove error after 5 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }
    
    showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.textContent = message;
        
        const downloadForm = document.querySelector('.download-form');
        downloadForm.parentNode.insertBefore(successDiv, downloadForm.nextSibling);
        
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    }
    
    clearError() {
        const existingError = document.querySelector('.error-message');
        const existingSuccess = document.querySelector('.success-message');
        
        if (existingError) existingError.remove();
        if (existingSuccess) existingSuccess.remove();
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value).replace(/`/g, '&#096;');
    }
}

// Global function to reset download
function resetDownload() {
    const downloader = window.instaReelDownloader;
    downloader.hideResults();
    downloader.videoUrlInput.value = '';
    downloader.videoUrlInput.focus();
    downloader.clearError();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.instaReelDownloader = new InstaReelDownloader();
});

// Add touch event listeners for better mobile UX
document.addEventListener('touchstart', function() {}, { passive: true });

// Prevent zoom on input focus for iOS
document.addEventListener('touchstart', function(e) {
    if (e.target.type === 'text' || e.target.type === 'url') {
        e.target.style.fontSize = '16px';
    }
});

// Add some interactive effects
document.addEventListener('DOMContentLoaded', function() {
    // Add loading animation to features cards on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe feature cards and steps
    document.querySelectorAll('.feature-card, .step, .platform-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
});
