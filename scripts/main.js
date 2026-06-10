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
            
            // FIX 1: Expanded regex parameters to seamlessly handle stories, highlights, and profile links
            const allowedPath = /^\/(reel|reels|p|tv|stories|s)\/([A-Za-z0-9_\-]+)/i;
            const paths = parsed.pathname.split('/').filter(Boolean);

            if (!['http:', 'https:'].includes(parsed.protocol) || !allowedHosts.includes(parsed.hostname.toLowerCase())) {
                return false;
            }

            // Allow general single root strings for automated profile lookups
            if (paths.length === 1) return true;

            return allowedPath.test(parsed.pathname);
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
            this.showError('Please enter a valid public Instagram link\n\nSupported formats:\n• Reels & Videos\n• Photos & Carousels\n• Stories & Highlights');
            return;
        }
        
        this.setLoadingState(true);
        this.hideResults();
        this.clearError();
        
        try {
            const videoData = await this.processVideo(url);
            this.showResults(videoData);
            this.showSuccess('Media resolved successfully. Choose a download option below.');
        } catch (error) {
            this.showError(error.message || 'Failed to process link. Ensure the content is public and try again.');
            console.error('Error:', error);
        } finally {
            this.setLoadingState(false);
        }
    }
    
    async processVideo(url) {
        this.showProgress('Processing link...', 30);

        let response;

        try {
            response = await fetch(this.apiUrl(`/api/resolve?url=${encodeURIComponent(url)}`));
        } catch (error) {
            throw new Error('Backend server is not running. Verify your server script instance is live.');
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Frontend structural route mismatch. Reaching static asset instead of API context endpoints.');
        }

        const videoData = await response.json();

        this.showProgress('Preparing download elements...', 90);

        if (!response.ok || !videoData.success) {
            throw new Error(videoData.error || 'Could not extract media assets from this address.');
        }

        return videoData;
    }
    
    showProgress(message, percent) {
        console.log(`${message} (${percent}%)`);
    }
    
    setLoadingState(loading) {
        const btnText = this.downloadBtn.querySelector('.btn-text');
        const btnLoading = this.downloadBtn.querySelector('.btn-loading');
        
        if (loading) {
            if (btnText) btnText.style.display = 'none';
            if (btnLoading) btnLoading.style.display = 'flex';
            this.downloadBtn.disabled = true;
            this.downloadBtn.style.opacity = '0.8';
        } else {
            if (btnText) btnText.style.display = 'flex';
            if (btnLoading) btnLoading.style.display = 'none';
            this.downloadBtn.disabled = false;
            this.downloadBtn.style.opacity = '1';
        }
    }
    
    showResults(videoData) {
        if (!videoData.success) {
            throw new Error(videoData.error || 'Processing failed');
        }

        const safeTitle = this.escapeHtml(videoData.title || 'Instagram content');
        const safeUploader = this.escapeHtml(videoData.uploader || '');
        
        // Setup initial metadata preview display card
        const singleThumbnail = videoData.thumbnail 
            ? this.apiUrl(`/api/thumbnail?url=${encodeURIComponent(videoData.thumbnail)}`)
            : '';
        const safeThumbnail = this.escapeAttribute(singleThumbnail);

        this.videoPreview.innerHTML = `
            <div class="result-card">
                <div class="video-thumb-shell">
                    ${safeThumbnail ? `<img src="${safeThumbnail}" alt="${safeTitle}" class="video-thumbnail-img">` : ''}
                    <div class="video-thumbnail-fallback ${safeThumbnail ? 'is-hidden' : ''}">
                        <span class="fallback-icon">▶</span>
                        <span>Preview ready</span>
                    </div>
                </div>
                <div class="video-meta">
                    <h3>${safeTitle}</h3>
                    <p>${safeUploader ? safeUploader : 'Public Instagram Asset'}</p>
                </div>
            </div>
        `;

        // Manage preview load fallbacks gracefully
        const thumbnailImg = this.videoPreview.querySelector('.video-thumbnail-img');
        const thumbnailFallback = this.videoPreview.querySelector('.video-thumbnail-fallback');
        if (thumbnailImg && thumbnailFallback) {
            thumbnailImg.addEventListener('load', () => thumbnailFallback.classList.add('is-hidden'));
            thumbnailImg.addEventListener('error', () => {
                thumbnailImg.remove();
                thumbnailFallback.classList.remove('is-hidden');
            });
        }
        
        // FIX 2: Dynamic Format Router Block handling single item streams or complex Carousel layout packs cleanly
        let optionsHtml = '';

        if (videoData.entries && videoData.entries.length > 0) {
            // Handle Album Carousel Collections
            optionsHtml = `<div class="carousel-downloads-grid">`;
            videoData.entries.forEach((entry, index) => {
                const format = entry.formats[0] || { quality: 'HQ Asset', size: 'Source', format: 'FILE', formatId: 'best' };
                const downloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(videoData.sourceUrl)}&format_id=${encodeURIComponent(format.formatId)}&filename=${encodeURIComponent(entry.filename || `file_${index + 1}`)}&type=video`);
                
                optionsHtml += `
                    <a href="${downloadUrl}" class="download-option-btn item-index-${index}">
                        <span class="download-icon" aria-hidden="true">↓</span>
                        <span class="download-info">
                            <strong>Download Part ${index + 1}</strong>
                            <small>${this.escapeHtml(format.quality)} (${this.escapeHtml(format.size)})</small>
                        </span>
                    </a>
                `;
            });
            optionsHtml += `</div>`;
        } else if (videoData.formats && videoData.formats.length > 0) {
            // Handle Single Reels, Photos, or Audio Post streams
            optionsHtml = videoData.formats.map((format) => {
                const downloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(videoData.sourceUrl)}&format_id=${encodeURIComponent(format.formatId)}&filename=${encodeURIComponent(videoData.filename || 'instagram-download')}&type=video`);
                const quality = this.escapeHtml(format.quality || 'Download');
                const size = this.escapeHtml(format.size || 'Source file');
                const fileFormat = this.escapeHtml(format.format || 'Media');
                const qualityClass = this.escapeAttribute(format.quality || 'best').toLowerCase().replace(/\s+/g, '-');

                return `
                    <a href="${downloadUrl}" class="download-option-btn ${qualityClass}">
                        <span class="download-icon" aria-hidden="true">↓</span>
                        <span class="download-info">
                            <strong>Download ${quality}</strong>
                            <small>${size} - ${fileFormat}</small>
                        </span>
                    </a>
                `;
            }).join('');
        } else {
            // Ultimate fallback safety link route if array data configurations are warped
            const directUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(videoData.sourceUrl)}&format_id=best&filename=download&type=video`);
            optionsHtml = `
                <a href="${directUrl}" class="download-option-btn best">
                    <span class="download-icon" aria-hidden="true">↓</span>
                    <span class="download-info">
                        <strong>Download Media Asset</strong>
                        <small>Direct Server Download</small>
                    </span>
                </a>
            `;
        }

        this.downloadOptions.innerHTML = optionsHtml;
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
        if (downloadForm) {
            downloadForm.parentNode.insertBefore(errorDiv, downloadForm.nextSibling);
        }
        
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
        if (downloadForm) {
            downloadForm.parentNode.insertBefore(successDiv, downloadForm.nextSibling);
        }
        
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
    if (!downloader) return;
    downloader.hideResults();
    downloader.videoUrlInput.value = '';
    downloader.videoUrlInput.focus();
    downloader.clearError();
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize application core
document.addEventListener('DOMContentLoaded', () => {
    window.instaReelDownloader = new InstaReelDownloader();
});

// Add touch event listeners for better mobile UX
document.addEventListener('touchstart', function() {}, { passive: true });

// Prevent auto-zoom on input focus for iOS devices
document.addEventListener('touchstart', function(e) {
    if (e.target.type === 'text' || e.target.type === 'url') {
        e.target.style.fontSize = '16px';
    }
});

// Reveal animations on scroll
document.addEventListener('DOMContentLoaded', function() {
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

    document.querySelectorAll('.feature-card, .step, .platform-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
});

// FAQ Accordion (Using Event Delegation Pattern)
document.addEventListener('DOMContentLoaded', function () {
    const accordion = document.getElementById('faqAccordion');
    if (!accordion) return;

    accordion.addEventListener('click', function (e) {
        const btn = e.target.closest('.faq-question');
        if (!btn) return;

        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        const answerId = btn.getAttribute('aria-controls');
        const answer = document.getElementById(answerId);

        accordion.querySelectorAll('.faq-question[aria-expanded="true"]').forEach(openBtn => {
            if (openBtn !== btn) {
                openBtn.setAttribute('aria-expanded', 'false');
                const otherId = openBtn.getAttribute('aria-controls');
                const otherAnswer = document.getElementById(otherId);
                if (otherAnswer) otherAnswer.classList.remove('is-open');
            }
        });

        btn.setAttribute('aria-expanded', String(!isOpen));
        if (answer) answer.classList.toggle('is-open', !isOpen);
    });
});

// Mobile Hamburger Navigation Menu Toggle
document.addEventListener('DOMContentLoaded', function () {
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');

    if (!menuToggle || !navLinks) return;

    menuToggle.addEventListener('click', function () {
        const isActive = navLinks.classList.toggle('is-active');
        menuToggle.classList.toggle('is-active');
        menuToggle.setAttribute('aria-expanded', String(isActive));
    });

    navLinks.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('is-active');
            menuToggle.classList.remove('is-active');
            menuToggle.setAttribute('aria-expanded', 'false');
        });
    });
});