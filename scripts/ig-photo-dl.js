class InstaPhotoDownloader {
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
        
        this.videoUrlInput.value = '';
        this.videoUrlInput.focus();
        
        this.videoUrlInput.addEventListener('input', () => {
            this.clearError();
        });
    }
    
    validateInstagramUrl(url) {
        try {
            const parsed = new URL(url.trim());
            const allowedHosts = ['instagram.com', 'www.instagram.com', 'm.instagram.com'];
            
            // Fixed Regex: Relaxes strict path borders and allows trailing flags/slashes natively
            const allowedPath = /^\/(reel|reels|p|tv|stories)\/([A-Za-z0-9_\-]+)/i;

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
            this.showError('Please enter a valid public Instagram photo or carousel URL\n\nSupported formats:\n• https://www.instagram.com/p/ABC123...');
            return;
        }
        
        this.setLoadingState(true);
        this.hideResults();
        this.clearError();
        
        try {
            const data = await this.processUrl(url);
            this.displayResults(data);
            this.showSuccess('Photos ready. Download your images below.');
        } catch (error) {
            this.showError(error.message || 'Failed to process post. Please check the URL and try again.');
            console.error('Error:', error);
        } finally {
            this.setLoadingState(false);
        }
    }
    
    async processUrl(url) {
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

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Could not extract photos from this Instagram post.');
        }

        return data;
    }
    
    displayResults(data) {
        if (!data.success) {
            throw new Error(data.error || 'Processing failed');
        }

        const safeTitle = this.escapeHtml(data.title || 'Instagram Photo');
        const safeUploader = this.escapeHtml(data.uploader || '');

        const entries = data.entries || [];
        const isSinglePost = entries.length === 0;

        if (isSinglePost) {
            // Fix: Fallback directly to thumbnail preview source url token if dynamic proxy missing
            const rawThumbnail = data.thumbnail || data.url || data.sourceUrl;
            const thumbnailUrl = rawThumbnail ? this.apiUrl(`/api/thumbnail?url=${encodeURIComponent(rawThumbnail)}`) : '';
            const safeThumbnail = this.escapeAttribute(thumbnailUrl);

            this.videoPreview.innerHTML = `
                <div class="result-card">
                    <div class="video-thumb-shell" style="max-width: 320px; height: 320px; margin: 0 auto; overflow: hidden; border-radius: 8px;">
                        ${safeThumbnail ? `<img src="${safeThumbnail}" alt="${safeTitle}" class="video-thumbnail-img" style="width:100%; height:100%; object-fit:cover;">` : ''}
                        <div class="video-thumbnail-fallback ${safeThumbnail ? 'is-hidden' : ''}">
                            <span class="fallback-icon">📷</span>
                            <span>Preview unavailable</span>
                        </div>
                    </div>
                    <div class="video-meta" style="text-align: center; margin-top: 15px;">
                        <h3>${safeTitle}</h3>
                        ${safeUploader ? `<p>${safeUploader}</p>` : '<p>Public Instagram photo</p>'}
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

            // Fix: Build a default safe fallback format array matrix if backend doesn't output structural "formats" arrays for images
            const visualFormats = data.formats && data.formats.length > 0 ? data.formats : [{ formatId: 'best', quality: 'HD Quality', size: 'Original Size', format: 'JPEG' }];

            this.downloadOptions.innerHTML = visualFormats.map((format) => {
                const targetMediaUrl = data.url || data.sourceUrl;
                const downloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(targetMediaUrl)}&format_id=${encodeURIComponent(format.formatId)}&filename=${encodeURIComponent(data.filename || 'instagram-photo')}`);
                const quality = this.escapeHtml(format.quality || 'Best');
                const size = this.escapeHtml(format.size || 'HD');
                const fileFormat = this.escapeHtml(format.format || 'JPEG');

                return `
                <a href="${downloadUrl}" class="download-option-btn best" download target="_blank">
                    <span class="download-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </span>
                    <span class="download-info">
                        <strong>Download Photo (${quality})</strong>
                        <small>${size} - ${fileFormat}</small>
                    </span>
                </a>
                `;
            }).join('');

        } else {
            // Carousel array path block engine rules
            this.videoPreview.innerHTML = `
                <div class="photo-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-top: 20px;">
                    ${entries.map((entry, index) => {
                        const entryTitle = this.escapeHtml(entry.title || `Photo ${index + 1}`);
                        const rawEntryThumb = entry.thumbnail || entry.url;
                        const entryThumb = rawEntryThumb ? this.apiUrl(`/api/thumbnail?url=${encodeURIComponent(rawEntryThumb)}`) : '';
                        const safeEntryThumb = this.escapeAttribute(entryThumb);
                        
                        const entryFormatId = entry.formats && entry.formats.length > 0 ? entry.formats[0].formatId : 'best';
                        const entryDownloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(entry.url || data.sourceUrl)}&format_id=${encodeURIComponent(entryFormatId)}&filename=${encodeURIComponent(entry.filename || `instagram-photo-${index + 1}`)}`);

                        return `
                        <div class="photo-card" style="border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; background: #fff; display: flex; flex-direction: column;">
                            <div class="photo-card-image" style="height: 240px; background: #f0f0f0; overflow:hidden;">
                                ${safeEntryThumb ? `<img src="${safeEntryThumb}" alt="${entryTitle}" loading="lazy" style="width:100%; height:100%; object-fit:cover;">` : `<div class="photo-card-placeholder" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:24px;"><span>📷</span></div>`}
                            </div>
                            <div class="photo-card-footer" style="padding: 15px; display: flex; flex-direction: column; gap: 10px; margin-top: auto;">
                                <span class="photo-card-label" style="font-weight:600; font-size:14px; color:var(--text-main);">${entryTitle}</span>
                                <a href="${entryDownloadUrl}" class="photo-card-download" download target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent-color, #0076ff); color: #fff; padding: 10px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    Download
                                </a>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            `;

            this.downloadOptions.innerHTML = '';
        }
        
        this.resultsSection.style.display = 'block';
        setTimeout(() => {
            this.resultsSection.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start' 
            });
        }, 100);
    }
    
    setLoadingState(loading) {
        const btnText = this.downloadBtn.querySelector('.btn-text');
        const btnLoading = this.downloadBtn.querySelector('.btn-loading');
        
        if (!btnText || !btnLoading) return;
        
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
        if(downloadForm) {
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
        if(downloadForm) {
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
    const downloader = window.instaPhotoDownloader;
    if (!downloader) return;
    downloader.hideResults();
    downloader.videoUrlInput.value = '';
    downloader.videoUrlInput.focus();
    downloader.clearError();
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize application core
document.addEventListener('DOMContentLoaded', () => {
    window.instaPhotoDownloader = new InstaPhotoDownloader();
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