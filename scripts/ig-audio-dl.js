class InstaAudioDownloader {
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
            const allowedPath = /^\/(reel|reels|p|tv)\/([A-Za-z0-9_\-]+)/i;

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
            this.showError('Please enter a valid public Instagram Reel or video URL\n\nSupported formats:\n• https://www.instagram.com/reel/ABC123...\n• https://www.instagram.com/p/XYZ789...\n• https://www.instagram.com/tv/...');
            return;
        }
        
        this.setLoadingState(true);
        this.hideResults();
        this.clearError();
        
        try {
            const data = await this.processUrl(url);
            this.displayResults(data);
            this.showSuccess('Audio extracted! Preview and download below.');
        } catch (error) {
            this.showError(error.message || 'Failed to extract audio. Please check the URL and try again.');
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
            throw new Error(data.error || 'Could not extract audio from this Instagram video.');
        }

        return data;
    }
    
    displayResults(data) {
        if (!data.success) {
            throw new Error(data.error || 'Processing failed');
        }

        const safeTitle = this.escapeHtml(data.title || 'Instagram Audio');
        const safeUploader = this.escapeHtml(data.uploader || '');

        // Build the audio download URL - request audio-only format
        const audioDownloadUrl = this.apiUrl(`/api/download?url=${encodeURIComponent(data.sourceUrl)}&format_id=${encodeURIComponent('bestaudio[ext=m4a]/bestaudio/best')}&filename=${encodeURIComponent((data.filename || 'instagram-audio').replace(/\.mp4$/i, '.mp3'))}&type=audio`);

        // Build a proxied audio stream URL for the HTML5 audio preview
        const audioPreviewUrl = audioDownloadUrl;

        this.videoPreview.innerHTML = `
            <div class="result-card" style="grid-template-columns: 1fr; text-align: center;">
                <div class="video-meta" style="text-align: center;">
                    <h3>${safeTitle}</h3>
                    ${safeUploader ? `<p>${safeUploader}</p>` : '<p>Public Instagram audio</p>'}
                </div>
                <div class="audio-preview-container" style="width: 100%; padding: 16px 0;">
                    <audio controls preload="none" style="width: 100%; max-width: 480px; border-radius: 12px;">
                        <source src="${this.escapeAttribute(audioPreviewUrl)}" type="audio/mpeg">
                        <source src="${this.escapeAttribute(audioPreviewUrl)}" type="audio/mp4">
                        Your browser does not support audio playback.
                    </audio>
                </div>
            </div>
        `;

        this.downloadOptions.innerHTML = `
            <a href="${this.escapeAttribute(audioDownloadUrl)}" class="download-option-btn best" download>
                <span class="download-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                </span>
                <span class="download-info">
                    <strong>Download MP3 Audio</strong>
                    <small>High Quality Audio Track</small>
                </span>
            </a>
        `;
        
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
        downloadForm.parentNode.insertBefore(errorDiv, downloadForm.nextSibling);
        
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
    const downloader = window.instaAudioDownloader;
    if (!downloader) return;
    downloader.hideResults();
    downloader.videoUrlInput.value = '';
    downloader.videoUrlInput.focus();
    downloader.clearError();
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Initialize application core
document.addEventListener('DOMContentLoaded', () => {
    window.instaAudioDownloader = new InstaAudioDownloader();
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
