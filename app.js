// LumiFlix - Main Application
// Add this at the beginning of your constructor
constructor() {
    // Auto-detect backend URL (works on Vercel and local)
    this.backendUrl = this.detectBackendUrl();
    
    // Rest of your existing constructor code...
    // ... (keep all your existing code below)
}

// Add this new method
detectBackendUrl() {
    // Check if running on Vercel
    if (window.location.hostname.includes('vercel.app')) {
        // On Vercel, API is at the same domain with HTTPS
        return '';
    }
    
    // Local development
    const hostname = window.location.hostname;
    return `http://${hostname}:3005`;
}

// Replace your existing fetchWithBackend method
async fetchWithBackend(endpoint) {
    // On Vercel, use /api prefix, otherwise use full URL with port
    const url = this.backendUrl 
        ? `${this.backendUrl}${endpoint}`
        : `/api${endpoint}`;
    
    try {
        const response = await fetch(url);
        return response;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Replace your checkBackendHealth method
async checkBackendHealth() {
    try {
        const response = await this.fetchWithBackend('/health');
        
        if (response.ok) {
            const data = await response.json();
            console.log('Backend connected:', data);
        } else {
            console.warn('Backend not responding optimally');
        }
    } catch (error) {
        console.warn('Backend not available - using TMDB only');
        // Don't show error notification on Vercel
        if (!window.location.hostname.includes('vercel.app')) {
            this.showNotification('Backend connection failed. Make sure server.js is running on port 3005', 'warning');
        }
    }
}

class LumiFlix {
    constructor() {
        // Auto-detect backend URL
        const hostname = window.location.hostname;
        this.backendPort = 3005;
        this.backendUrl = `http://${hostname}:${this.backendPort}`;
        
        // ===== VERSION CONTROL =====
        // MANUALLY CHANGE THIS FOR MAJOR UPDATES THAT NEED CACHE CLEAR
        this.appVersion = '2.1.1'; // Change this to clear cache (e.g., 2.0.0 -> 2.1.0)
        
        // ===== AUTO-UPDATE FEATURE =====
        // This enables automatic content updates WITHOUT clearing cache
        this.autoUpdateEnabled = true;
        this.updateCheckInterval = 30 * 60 * 1000; // Check for updates every 30 minutes
        this.lastContentUpdate = null;
        this.contentVersion = this.loadContentVersion();
        // ===============================
        
        this.checkAndClearCache();
        
        this.tmdbApiKey = '8d576c8468ee033709f1ea35619de69d';
        this.tmdbBase = 'https://api.themoviedb.org/3';
        this.tmdbImageBase = 'https://image.tmdb.org/t/p/';
        this.youtubeBase = 'https://www.youtube.com/embed/';
        this.currentView = 'home';
        this.currentMedia = null;
        this.currentEpisode = null;
        
        // Add loading flag to prevent multiple detail loads
        this.isLoadingDetail = false;
        
        // Load data (after potential cache clear)
        this.watchProgress = this.loadProgress();
        this.wishlist = this.loadWishlist();
        this.searchHistory = this.loadSearchHistory();
        
        this.player = null;
        this.hls = null;
        this.trailerPlayer = null;
        this.isPlayerActive = false;
        this.isLoading = false;
        this.isPlaying = false;
        
        // Screen orientation state
        this.wasLandscape = false;
        this.orientationHandler = null;
        
        // Controls auto-hide
        this.controlsTimeout = null;
        this.isControlsVisible = true;
        
        // Fullscreen state
        this.wasFullscreen = false;
        
        // Cached content for auto-update
        this.cachedContent = this.loadCachedContent();
        
        this.init();
    }
    
    // ============== AUTO-UPDATE FEATURE ==============
    
    loadContentVersion() {
        try {
            return parseInt(localStorage.getItem('lumiflix_content_version')) || 1;
        } catch {
            return 1;
        }
    }
    
    saveContentVersion() {
        localStorage.setItem('lumiflix_content_version', this.contentVersion.toString());
    }
    
    loadCachedContent() {
        try {
            return JSON.parse(localStorage.getItem('lumiflix_cached_content')) || {
                trendingMovies: null,
                trendingTV: null,
                popularMovies: null,
                popularTV: null,
                lastUpdate: null
            };
        } catch {
            return {
                trendingMovies: null,
                trendingTV: null,
                popularMovies: null,
                popularTV: null,
                lastUpdate: null
            };
        }
    }
    
    saveCachedContent() {
        this.cachedContent.lastUpdate = Date.now();
        localStorage.setItem('lumiflix_cached_content', JSON.stringify(this.cachedContent));
    }
    
    async startAutoUpdate() {
        if (!this.autoUpdateEnabled) return;
        
        // Check for updates immediately
        await this.checkForContentUpdates();
        
        // Set up interval for periodic updates
        setInterval(() => {
            this.checkForContentUpdates();
        }, this.updateCheckInterval);
    }
    
    async checkForContentUpdates() {
        try {
            // Fetch latest content from TMDB
            const [trendingMovies, trendingTV, popularMovies, popularTV] = await Promise.all([
                this.fetchFromTMDB('/trending/movie/week'),
                this.fetchFromTMDB('/trending/tv/week'),
                this.fetchFromTMDB('/movie/popular'),
                this.fetchFromTMDB('/tv/popular')
            ]);
            
            // Check if content has changed
            const hasNewContent = this.hasContentChanged(
                trendingMovies,
                trendingTV,
                popularMovies,
                popularTV
            );
            
            if (hasNewContent) {
                // Update cached content
                this.cachedContent = {
                    trendingMovies,
                    trendingTV,
                    popularMovies,
                    popularTV,
                    lastUpdate: Date.now()
                };
                
                // Increment content version
                this.contentVersion++;
                this.saveContentVersion();
                this.saveCachedContent();
                
                // Show notification to user
                this.showNotification('🎬 New content available! Refreshing...', 'info');
                
                // Reload current view if on home page
                if (this.currentView === 'home') {
                    setTimeout(() => this.loadHome(), 1500);
                }
            }
            
        } catch (error) {
            // Silent fail for auto-update
        }
    }
    
    hasContentChanged(newTrendingMovies, newTrendingTV, newPopularMovies, newPopularTV) {
        // Compare with cached content
        if (!this.cachedContent.trendingMovies) return true;
        
        // Check if any new items appeared in trending
        const oldTrendingIds = new Set(this.cachedContent.trendingMovies.results?.map(m => m.id) || []);
        const newTrendingIds = new Set(newTrendingMovies.results?.map(m => m.id) || []);
        
        for (const id of newTrendingIds) {
            if (!oldTrendingIds.has(id)) {
                return true; // New movie found
            }
        }
        
        // Check popular movies
        const oldPopularIds = new Set(this.cachedContent.popularMovies.results?.map(m => m.id) || []);
        const newPopularIds = new Set(newPopularMovies.results?.map(m => m.id) || []);
        
        for (const id of newPopularIds) {
            if (!oldPopularIds.has(id)) {
                return true; // New popular movie found
            }
        }
        
        return false;
    }
    
    // ============== CACHE CLEARING ON VERSION CHANGE ==============
    
    checkAndClearCache() {
        const storedVersion = localStorage.getItem('lumiflix_app_version');
        
        // If version doesn't match or this is first run, clear all storage
        if (storedVersion !== this.appVersion) {
            this.clearAllStorage();
            localStorage.setItem('lumiflix_app_version', this.appVersion);
            
            // Show notification to user
            setTimeout(() => {
                this.showNotification('✨ App updated - New features available!', 'success');
            }, 1000);
        }
    }
    
    clearAllStorage() {
        // Clear ONLY app version related items, NOT user data
        // This preserves watch progress, wishlist, and search history
        const keysToRemove = [
            'lumiflix_app_version',
            'lumiflix_cached_content' // Clear cached content but keep user data
        ];
        
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }
    
    // ============== FULLSCREEN FIX METHODS ==============
    
    handleFullscreenExit() {
        // Remove fullscreen class from body
        document.body.classList.remove('fullscreen-active');
        
        // Restore body styles
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
        document.body.style.touchAction = '';
        
        // Force a repaint to fix any rendering issues
        document.body.style.display = 'none';
        document.body.offsetHeight; // Force reflow
        document.body.style.display = '';
    }
    
    toggleFullscreen() {
        const container = document.querySelector('.video-container');
        if (!container) return;
        
        if (!document.fullscreenElement) {
            // Enter fullscreen
            container.requestFullscreen()
                .then(() => {
                    document.body.classList.add('fullscreen-active');
                    this.wasFullscreen = true;
                })
                .catch(err => {
                    // Silent fail
                });
        } else {
            // Exit fullscreen
            document.exitFullscreen()
                .then(() => {
                    this.handleFullscreenExit();
                    this.wasFullscreen = false;
                })
                .catch(err => {
                    // Silent fail
                });
        }
    }
    
    setupFullscreenListeners() {
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                // We've exited fullscreen
                this.handleFullscreenExit();
                this.wasFullscreen = false;
            }
        });
        
        document.addEventListener('mozfullscreenchange', () => {
            if (!document.mozFullScreenElement) {
                this.handleFullscreenExit();
                this.wasFullscreen = false;
            }
        });
        
        document.addEventListener('webkitfullscreenchange', () => {
            if (!document.webkitFullscreenElement) {
                this.handleFullscreenExit();
                this.wasFullscreen = false;
            }
        });
        
        document.addEventListener('MSFullscreenChange', () => {
            if (!document.msFullscreenElement) {
                this.handleFullscreenExit();
                this.wasFullscreen = false;
            }
        });
    }
    
    forceCleanup() {
        // Clean up HLS
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        
        // Clean up player
        if (this.player) {
            this.player.pause();
            this.player.src = '';
            this.player.load();
        }
        
        // Remove player active state from body
        const overlay = document.getElementById('videoPlayerOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
        
        // Reset body styles
        document.body.classList.remove('player-active', 'fullscreen-active');
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
        document.body.style.touchAction = '';
        
        // Force repaint
        document.body.style.display = 'none';
        document.body.offsetHeight;
        document.body.style.display = '';
        
        this.isPlayerActive = false;
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        
        // Remove orientation handler
        if (this.orientationHandler) {
            window.removeEventListener('resize', this.orientationHandler);
            window.removeEventListener('orientationchange', this.orientationHandler);
        }
        
        // Clear controls timeout
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
            this.controlsTimeout = null;
        }
    }
    
    setupEscapeKeyHandler() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isPlayerActive) {
                this.closePlayer();
            }
        });
    }
    
    setupBackButtonHandling() {
        // Detect if running in a browser that supports the back button API
        if (window.history && window.history.pushState) {
            // Add a state to history when player opens
            window.history.pushState({ playerActive: true }, '');
            
            // Listen for popstate (back button)
            window.addEventListener('popstate', (e) => {
                if (this.isPlayerActive) {
                    e.preventDefault();
                    this.closePlayer();
                    
                    // Push a new state to prevent immediate exit
                    window.history.pushState({ playerActive: false }, '');
                }
            });
        }
    }
    
    // ============== EXISTING METHODS ==============
    
    loadSearchHistory() {
        try {
            return JSON.parse(localStorage.getItem('lumiflix_search_history')) || [];
        } catch {
            return [];
        }
    }
    
    saveSearchHistory() {
        // Keep only last 5 searches
        if (this.searchHistory.length > 5) {
            this.searchHistory = this.searchHistory.slice(0, 5);
        }
        localStorage.setItem('lumiflix_search_history', JSON.stringify(this.searchHistory));
    }
    
    addToSearchHistory(query) {
        if (!query || query.trim().length < 2) return;
        
        // Remove if already exists
        const index = this.searchHistory.indexOf(query);
        if (index !== -1) {
            this.searchHistory.splice(index, 1);
        }
        
        // Add to beginning
        this.searchHistory.unshift(query);
        
        // Keep only last 5
        if (this.searchHistory.length > 5) {
            this.searchHistory = this.searchHistory.slice(0, 5);
        }
        
        this.saveSearchHistory();
        this.renderSearchHistory();
    }
    
    renderSearchHistory() {
        const searchHistory = document.getElementById('searchHistory');
        if (!searchHistory) return;
        
        if (this.searchHistory.length === 0) {
            searchHistory.style.display = 'none';
            return;
        }
        
        searchHistory.style.display = 'block';
        let html = '<div class="search-history-header">Recent Searches</div>';
        
        this.searchHistory.forEach(query => {
            const escapedQuery = this.escapeHtml(query);
            html += `
                <div class="search-history-item" data-query="${escapedQuery}">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    ${this.escapeHtml(query)}
                    <button class="remove-search" onclick="event.stopPropagation(); app.removeSearchHistoryItem('${escapedQuery}')">&times;</button>
                </div>
            `;
        });
        
        searchHistory.innerHTML = html;
        
        // Add click handlers
        document.querySelectorAll('.search-history-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('remove-search')) {
                    const query = item.dataset.query;
                    document.getElementById('searchInput').value = query;
                    this.search(query);
                    this.hideSearchHistory();
                }
            });
        });
    }
    
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    removeSearchHistoryItem(query) {
        const index = this.searchHistory.indexOf(query);
        if (index !== -1) {
            this.searchHistory.splice(index, 1);
            this.saveSearchHistory();
            this.renderSearchHistory();
        }
    }
    
    showSearchHistory() {
        const searchHistory = document.getElementById('searchHistory');
        if (searchHistory && this.searchHistory.length > 0) {
            searchHistory.style.display = 'block';
        }
    }
    
    hideSearchHistory() {
        const searchHistory = document.getElementById('searchHistory');
        if (searchHistory) {
            setTimeout(() => {
                searchHistory.style.display = 'none';
            }, 200);
        }
    }
    
    async init() {
        // Add favicon if missing
        this.addFavicon();
        
        // Setup orientation handling for mobile
        this.setupOrientationHandling();
        
        // Setup fullscreen listeners
        this.setupFullscreenListeners();
        
        // Setup escape key handler
        this.setupEscapeKeyHandler();
        
        // Setup back button handling
        this.setupBackButtonHandling();
        
        // Start auto-update feature
        await this.startAutoUpdate();
        
        // Hide initial loader after app is ready
        setTimeout(() => {
            const appLoading = document.getElementById('appLoading');
            const appContainer = document.getElementById('appContainer');
            if (appLoading && appContainer) {
                appLoading.style.opacity = '0';
                setTimeout(() => {
                    appLoading.classList.add('hidden');
                    appContainer.classList.remove('hidden');
                    appContainer.classList.add('visible');
                }, 800);
            }
        }, 1500);
        
        // Check backend health
        await this.checkBackendHealth();
        
        // Setup navigation
        this.setupNavigation();
        
        // Setup search
        this.setupSearch();
        
        // Setup player
        this.setupPlayer();
        
        // Setup trailer modal
        this.setupTrailerModal();
        
        // Setup wishlist UI
        this.setupWishlistUI();
        
        // Add enhanced styles for better content visibility
        this.addEnhancedWatermarkStyles();
        this.addResumeStyles();
        this.addCrewStyles();
        
        // Add mobile controls auto-hide styles
        this.addMobileControlsStyles();
        
        // Load initial content
        await this.loadHome();
        
        // Handle routing
        this.handleRoute();
        window.addEventListener('hashchange', () => this.handleRoute());
    }
    
    // ============== MOBILE CONTROLS AUTO-HIDE ==============
    
    addMobileControlsStyles() {
        if (document.getElementById('mobile-controls-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'mobile-controls-styles';
        style.textContent = `
            .video-controls {
                transition: opacity 0.3s ease;
                opacity: 1;
            }
            
            .video-controls.hidden {
                opacity: 0;
                pointer-events: none;
            }
            
            /* Keep progress bar container clickable even when controls are hidden */
            .video-controls.hidden #progressBarContainer {
                pointer-events: none;
            }
            
            /* Show controls when video container is hovered (desktop) or tapped (mobile) */
            .video-container:hover .video-controls {
                opacity: 1;
                pointer-events: all;
            }
            
            /* Ensure close button is always accessible */
            #closePlayerBtn {
                transition: opacity 0.3s ease;
            }
            
            .video-controls.hidden #closePlayerBtn {
                opacity: 0;
                pointer-events: none;
            }
            
            /* Mobile tap area for showing controls */
            .video-container {
                position: relative;
            }
            
            .video-container::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: transparent;
                pointer-events: none;
                z-index: 800;
            }
            
            .video-container.tapped::after {
                pointer-events: all;
            }
            
            /* Watermark and content overlay fade with controls */
            .content-info-overlay,
            .lumiflix-watermark {
                transition: opacity 0.3s ease;
            }
            
            .video-controls.hidden ~ .content-info-overlay,
            .video-controls.hidden + .lumiflix-watermark {
                opacity: 0.3;
            }
            
            @media (max-width: 768px) {
                .content-info-overlay {
                    max-width: 70%;
                }
                
                .content-title-badge {
                    font-size: 1.2rem;
                    padding: 8px 16px;
                }
                
                .content-meta-badge {
                    font-size: 0.9rem;
                    padding: 6px 12px;
                }
            }
            
            /* Fix for fullscreen exit freeze */
            body.fullscreen-active {
                overflow: hidden;
            }
            
            body:not(.fullscreen-active) {
                overflow: auto !important;
                position: static !important;
            }
            
            /* Ensure proper body state after player closes */
            body.player-closed {
                overflow: auto !important;
                position: static !important;
                height: auto !important;
                width: auto !important;
                touch-action: auto !important;
            }
        `;
        document.head.appendChild(style);
    }
    
    setupMobileControlsAutoHide() {
        const videoContainer = document.querySelector('.video-container');
        const controls = document.querySelector('.video-controls');
        
        if (!videoContainer || !controls) return;
        
        // Clear any existing timeout
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
        
        // Function to show controls
        const showControls = () => {
            controls.classList.remove('hidden');
            this.isControlsVisible = true;
            
            // Reset the auto-hide timer
            this.resetControlsTimer();
        };
        
        // Function to hide controls
        const hideControls = () => {
            // Only hide if video is playing
            if (this.isPlaying) {
                controls.classList.add('hidden');
                this.isControlsVisible = false;
            }
        };
        
        // Reset timer function
        this.resetControlsTimer = () => {
            if (this.controlsTimeout) {
                clearTimeout(this.controlsTimeout);
            }
            
            // Set new timer to hide controls after 3 seconds
            this.controlsTimeout = setTimeout(() => {
                hideControls();
            }, 3000);
        };
        
        // Touch event for mobile
        videoContainer.addEventListener('touchstart', (e) => {
            e.preventDefault();
            showControls();
        }, { passive: false });
        
        // Mouse move for desktop (also works on mobile simulators)
        videoContainer.addEventListener('mousemove', () => {
            showControls();
        });
        
        // Click/tap on video toggles controls visibility
        videoContainer.addEventListener('click', (e) => {
            // Don't toggle if clicking on controls
            if (e.target.closest('.video-controls')) {
                return;
            }
            
            if (this.isControlsVisible) {
                hideControls();
            } else {
                showControls();
            }
        });
        
        // Keep controls visible when interacting with them
        controls.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            this.resetControlsTimer();
        });
        
        controls.addEventListener('mousemove', () => {
            this.resetControlsTimer();
        });
        
        // Show controls initially
        showControls();
    }
    
    // ============== ENHANCED STYLES ==============
    
    addEnhancedWatermarkStyles() {
        if (document.getElementById('enhanced-watermark-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'enhanced-watermark-styles';
        style.textContent = `
            .video-container {
                position: relative;
                width: 100%;
                height: 100%;
                background: #000;
            }
            
            /* Meta Badge - Enhanced */
            .content-meta-badge {
                background: linear-gradient(135deg, 
                    rgba(0, 0, 0, 0.9) 0%,
                    rgba(20, 20, 20, 0.95) 100%);
                color: #ffd700;
                padding: 14px 28px;
                border-radius: 50px;
                font-size: 1.3rem;
                font-weight: 700;
                backdrop-filter: blur(12px);
                border: 2px solid rgba(255, 215, 0, 0.9);
                display: inline-flex;
                align-items: center;
                gap: 25px;
                margin-left: 10px;
                box-shadow: 
                    0 8px 25px rgba(0, 0, 0, 0.9),
                    0 0 20px rgba(255, 215, 0, 0.3);
                flex-wrap: wrap;
                text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9);
            }
            
            /* Individual meta items */
            .content-meta-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 5px 15px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 40px;
                border: 1px solid rgba(255, 215, 0, 0.3);
            }
            
            .content-meta-item svg {
                width: 20px;
                height: 20px;
                fill: #ffd700;
                filter: drop-shadow(0 2px 2px rgba(0,0,0,0.5));
            }
            
            /* Episode badge */
            .content-episode-badge {
                background: linear-gradient(135deg, #e50914, #b2070f);
                color: white;
                padding: 6px 15px;
                border-radius: 30px;
                font-size: 1.1rem;
                font-weight: 700;
                border: 2px solid #ffd700;
                box-shadow: 0 0 15px rgba(229, 9, 20, 0.5);
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            
            /* LumiFlix Watermark */
            .lumiflix-watermark {
                position: absolute;
                top: 30px;
                right: 30px;
                font-size: 1rem;
                font-weight: 600;
                letter-spacing: 4px;
                z-index: 1000;
                pointer-events: none;
                font-family: 'Arial Black', sans-serif;
            }
            
            /* Video controls enhancement */
            .video-controls {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: linear-gradient(to top, 
                    rgba(0,0,0,0.95) 0%,
                    rgba(0,0,0,0.8) 50%,
                    transparent 100%);
                padding: 30px;
                z-index: 900;
                transition: opacity 0.3s ease;
            }
            
            /* Mobile optimizations */
            @media (max-width: 768px) {
                .content-info-overlay {
                    top: 20px;
                    left: 20px;
                    gap: 10px;
                    max-width: 90%;
                }
                
                .content-title-badge {
                    font-size: 1.5rem;
                    padding: 12px 20px;
                }
                
                .content-meta-badge {
                    font-size: 1rem;
                    padding: 10px 18px;
                    gap: 15px;
                }
                
                .lumiflix-watermark {
                    font-size: 1.3rem;
                    top: 20px;
                    right: 20px;
                    padding: 8px 18px;
                }
                
                .video-controls {
                    padding: 15px;
                }
            }
            
            /* Landscape mode */
            @media (orientation: landscape) and (max-width: 900px) {
                .content-title-badge {
                    font-size: 1.3rem;
                    padding: 10px 18px;
                }
                
                .content-meta-badge {
                    font-size: 0.9rem;
                    padding: 8px 15px;
                }
            }
            
            /* Fullscreen optimizations */
            .video-container:fullscreen .content-title-badge {
                font-size: 2.8rem;
                padding: 25px 45px;
            }
            
            .video-container:fullscreen .content-meta-badge {
                font-size: 1.6rem;
                padding: 18px 35px;
            }
            
            .video-container:fullscreen .lumiflix-watermark {
                font-size: 2.5rem;
                padding: 15px 40px;
            }
            
            /* Animation for title entrance */
            @keyframes slideInLeft {
                from {
                    opacity: 0;
                    transform: translateX(-50px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            
            /* Add glowing effect on hover */
            .video-container:hover .content-title-badge {
                box-shadow: 
                    0 15px 40px rgba(0, 0, 0, 0.9),
                    0 0 40px rgba(229, 9, 20, 0.8),
                    0 0 60px rgba(255, 215, 0, 0.5);
            }
        `;
        document.head.appendChild(style);
    }
    
    addWatermark() {
        const container = document.querySelector('.video-container');
        if (!container) return;
        
        // Check if watermark already exists
        if (container.querySelector('.lumiflix-watermark')) return;
        
        const watermark = document.createElement('div');
        watermark.className = 'lumiflix-watermark';
        watermark.textContent = 'LUMIFLIX';
        container.appendChild(watermark);
        
        // Add enhanced content info overlay
        this.addEnhancedContentInfoOverlay(container);
    }
    
    addEnhancedContentInfoOverlay(container) {
        // Remove existing overlay if any
        const existingOverlay = container.querySelector('.content-info-overlay');
        if (existingOverlay) existingOverlay.remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'content-info-overlay';
        
        // Add content title with enhanced styling
        if (this.currentMedia) {
            const title = this.currentMedia.title || this.currentMedia.name || 'Now Playing';
            const year = (this.currentMedia.release_date || this.currentMedia.first_air_date || '').substring(0, 4);
            const rating = this.currentMedia.vote_average ? this.currentMedia.vote_average.toFixed(1) : '';
            
            // Title with glowing effect
            const titleBadge = document.createElement('div');
            titleBadge.className = 'content-title-badge';
            
            // Add play icon before title
            titleBadge.innerHTML = `
                <svg viewBox="0 0 24 24" width="28" height="28" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
                    <path fill="currentColor" d="M8 5v14l11-7z"/>
                </svg>
                ${title}
            `;
            overlay.appendChild(titleBadge);
            
            const metaBadge = document.createElement('div');
            metaBadge.className = 'content-meta-badge';
            
            if (year) {
                metaBadge.innerHTML += `
                    <span class="content-meta-item">
                        <svg viewBox="0 0 24 24">
                            <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z"/>
                        </svg>
                        ${year}
                    </span>
                `;
            }
            
            if (rating) {
                metaBadge.innerHTML += `
                    <span class="content-meta-item">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                        </svg>
                        ${rating}/10
                    </span>
                `;
            }
            
            if (this.currentEpisode) {
                metaBadge.innerHTML += `
                    <span class="content-meta-item content-episode-badge">
                        Season ${this.currentEpisode.season} · Episode ${this.currentEpisode.episode}
                    </span>
                `;
            }
            
            // Add quality badge
            metaBadge.innerHTML += `
                <span class="content-meta-item">
                    <svg viewBox="0 0 24 24">
                        <path d="M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
                    </svg>
                    4K ULTRA HD
                </span>
            `;
            
            overlay.appendChild(metaBadge);
        }
        
        container.appendChild(overlay);
    }
    
    addContentInfoOverlay(container) {
        // Use enhanced version instead
        this.addEnhancedContentInfoOverlay(container);
    }
    
    // ============== ALL OTHER EXISTING METHODS REMAIN THE SAME ==============
    
    setupOrientationHandling() {
        // Check if device is mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
            // Handle orientation changes
            this.orientationHandler = () => {
                if (this.isPlayerActive && this.player) {
                    const isLandscape = window.innerWidth > window.innerHeight;
                    
                    if (isLandscape && !this.wasLandscape) {
                        // Entering landscape - try to go fullscreen
                        this.wasLandscape = true;
                        this.autoFullscreenOnLandscape();
                    } else if (!isLandscape && this.wasLandscape) {
                        // Exiting landscape
                        this.wasLandscape = false;
                    }
                }
            };
            
            window.addEventListener('resize', this.orientationHandler);
            window.addEventListener('orientationchange', this.orientationHandler);
        }
    }
    
    autoFullscreenOnLandscape() {
        // Automatically enter fullscreen when in landscape on mobile
        const container = document.querySelector('.video-container');
        if (container && !document.fullscreenElement) {
            container.requestFullscreen().catch(err => {
                // Silent fail for auto fullscreen
            });
        }
    }
    
    addFavicon() {
        // Check if favicon already exists
        if (!document.querySelector('link[rel="icon"]')) {
            const favicon = document.createElement('link');
            favicon.rel = 'icon';
            favicon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎬</text></svg>';
            document.head.appendChild(favicon);
        }
    }
    
    addResumeStyles() {
        if (document.getElementById('resume-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'resume-styles';
        style.textContent = `
            .resume-options {
                display: flex;
                gap: 1rem;
                margin-top: 1rem;
                flex-wrap: wrap;
            }
            
            .resume-btn {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 1rem 2rem;
                border-radius: 50px;
                font-size: 1.1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 0.8rem;
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                position: relative;
                overflow: hidden;
            }
            
            .resume-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.5s ease;
            }
            
            .resume-btn:hover::before {
                left: 100%;
            }
            
            .resume-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
            }
            
            .resume-btn:active {
                transform: translateY(0);
            }
            
            .resume-btn svg {
                width: 24px;
                height: 24px;
                filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
            }
            
            .resume-btn.restart {
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                box-shadow: 0 4px 15px rgba(245, 87, 108, 0.4);
            }
            
            .resume-time {
                background: rgba(255,255,255,0.2);
                padding: 0.3rem 0.8rem;
                border-radius: 20px;
                font-size: 0.9rem;
                margin-left: 0.5rem;
            }
            
            .play-btn-group {
                display: flex;
                gap: 1rem;
                align-items: center;
                flex-wrap: wrap;
            }
            
            .play-btn {
                background: linear-gradient(135deg, #e50914 0%, #b2070f 100%);
                color: white;
                border: none;
                padding: 1rem 2rem;
                border-radius: 50px;
                font-size: 1.2rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 0.8rem;
                box-shadow: 0 4px 15px rgba(229, 9, 20, 0.4);
                position: relative;
                overflow: hidden;
            }
            
            .play-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                transition: left 0.5s ease;
            }
            
            .play-btn:hover::before {
                left: 100%;
            }
            
            .play-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(229, 9, 20, 0.6);
            }
            
            .play-btn:active {
                transform: translateY(0);
            }
            
            .play-btn.small {
                padding: 0.6rem 1.2rem;
                font-size: 1rem;
            }
            
            .play-btn svg {
                width: 20px;
                height: 20px;
            }
            
            .episode-progress-indicator {
                position: absolute;
                bottom: 0;
                left: 0;
                height: 3px;
                background: linear-gradient(90deg, #e50914, #ff6b6b);
                transition: width 0.3s ease;
            }
            
            .episode-item {
                position: relative;
                overflow: hidden;
            }
            
            .episode-resume-badge {
                position: absolute;
                top: 10px;
                right: 10px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 0.3rem 0.8rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                z-index: 10;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
            
            .continue-watching-badge {
                position: absolute;
                bottom: 10px;
                right: 10px;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 0.5rem 1rem;
                border-radius: 30px;
                font-size: 0.9rem;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 0.5rem;
                backdrop-filter: blur(5px);
                border: 1px solid rgba(255,255,255,0.2);
                z-index: 10;
            }
            
            .continue-watching-badge svg {
                width: 16px;
                height: 16px;
                color: #e50914;
            }
        `;
        document.head.appendChild(style);
    }
    
    addCrewStyles() {
        if (document.getElementById('crew-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'crew-styles';
        style.textContent = `
            .crew-section {
                margin-top: 3rem;
                padding: 0 2rem;
            }
            
            .crew-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 1.5rem;
                margin-top: 1.5rem;
            }
            
            .crew-card {
                background: var(--bg-card);
                border-radius: 12px;
                overflow: hidden;
                transition: all 0.3s ease;
                cursor: pointer;
                border: 1px solid rgba(255,255,255,0.1);
            }
            
            .crew-card:hover {
                transform: translateY(-5px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.3);
                border-color: var(--primary);
            }
            
            .crew-image {
                width: 100%;
                aspect-ratio: 2/3;
                object-fit: cover;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
            }
            
            .crew-image-fallback {
                width: 100%;
                aspect-ratio: 2/3;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 2.5rem;
                font-weight: bold;
                text-transform: uppercase;
            }
            
            .crew-info {
                padding: 1rem;
            }
            
            .crew-name {
                font-weight: 600;
                font-size: 1rem;
                margin-bottom: 0.3rem;
                color: white;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .crew-role {
                font-size: 0.85rem;
                color: var(--text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .crew-character {
                font-size: 0.8rem;
                color: var(--primary);
                margin-top: 0.3rem;
                font-style: italic;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .crew-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.95);
                z-index: 3000;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(10px);
            }
            
            .crew-modal.active {
                display: flex;
            }
            
            .crew-modal-content {
                background: var(--bg-secondary);
                border-radius: 20px;
                width: 90%;
                max-width: 800px;
                max-height: 90vh;
                overflow-y: auto;
                animation: modalSlideUp 0.3s ease;
            }
            
            .crew-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1.5rem;
                background: var(--bg-card);
                border-bottom: 1px solid rgba(255,255,255,0.1);
                position: sticky;
                top: 0;
                z-index: 10;
            }
            
            .crew-modal-header h2 {
                color: white;
                font-size: 1.5rem;
            }
            
            .crew-modal-close {
                background: none;
                border: none;
                color: var(--text-secondary);
                font-size: 2rem;
                cursor: pointer;
                transition: var(--transition);
                line-height: 1;
                padding: 0 0.5rem;
            }
            
            .crew-modal-close:hover {
                color: var(--primary);
            }
            
            .crew-modal-body {
                padding: 1.5rem;
                display: flex;
                gap: 2rem;
                flex-wrap: wrap;
            }
            
            .crew-modal-image {
                width: 200px;
                border-radius: 12px;
                overflow: hidden;
                flex-shrink: 0;
            }
            
            .crew-modal-image img {
                width: 100%;
                aspect-ratio: 2/3;
                object-fit: cover;
            }
            
            .crew-modal-details {
                flex: 1;
            }
            
            .crew-modal-details h3 {
                font-size: 2rem;
                color: white;
                margin-bottom: 0.5rem;
            }
            
            .crew-modal-details .role {
                font-size: 1.2rem;
                color: var(--primary);
                margin-bottom: 1rem;
            }
            
            .crew-modal-details .bio {
                color: var(--text-secondary);
                line-height: 1.6;
                margin-bottom: 1.5rem;
                max-height: 200px;
                overflow-y: auto;
                padding-right: 1rem;
            }
            
            .crew-modal-details .info-item {
                margin-bottom: 0.8rem;
            }
            
            .crew-modal-details .info-label {
                font-weight: 600;
                color: white;
                margin-right: 0.5rem;
            }
            
            .crew-modal-details .info-value {
                color: var(--text-secondary);
            }
            
            .known-for-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                gap: 1rem;
                margin-top: 1rem;
            }
            
            .known-for-item {
                cursor: pointer;
                transition: var(--transition);
            }
            
            .known-for-item:hover {
                transform: scale(1.05);
            }
            
            .known-for-poster {
                width: 100%;
                aspect-ratio: 2/3;
                border-radius: 8px;
                overflow: hidden;
                margin-bottom: 0.5rem;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
            }
            
            .known-for-poster img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .known-for-title {
                font-size: 0.85rem;
                color: white;
                text-align: center;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            @media (max-width: 768px) {
                .crew-grid {
                    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
                }
                
                .crew-modal-body {
                    flex-direction: column;
                    align-items: center;
                }
                
                .crew-modal-image {
                    width: 150px;
                }
                
                .crew-modal-details h3 {
                    font-size: 1.5rem;
                    text-align: center;
                }
                
                .crew-modal-details .role {
                    text-align: center;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    setupWishlistUI() {
        // Add wishlist button to navigation
        const navRight = document.querySelector('.nav-right');
        if (navRight && !document.getElementById('wishlistBtn')) {
            const wishlistBtn = document.createElement('button');
            wishlistBtn.id = 'wishlistBtn';
            wishlistBtn.className = 'wishlist-nav-btn';
            wishlistBtn.setAttribute('aria-label', 'Wishlist');
            wishlistBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="24" height="24">
                    <path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span class="wishlist-count" id="wishlistCount">${this.wishlist.length}</span>
            `;
            wishlistBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.navigateTo('wishlist');
            });
            navRight.prepend(wishlistBtn);
        }
        
        // Add wishlist styles
        this.addWishlistStyles();
    }
    
    addWishlistStyles() {
        // Check if styles already exist
        if (document.getElementById('wishlist-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'wishlist-styles';
        style.textContent = `
            .wishlist-nav-btn {
                background: none;
                border: none;
                color: var(--text-secondary);
                cursor: pointer;
                padding: 0.5rem;
                border-radius: 50%;
                transition: var(--transition);
                position: relative;
                margin-right: 1rem;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .wishlist-nav-btn:hover {
                color: var(--primary);
                background: rgba(229, 9, 20, 0.1);
            }
            
            .wishlist-count {
                position: absolute;
                top: -5px;
                right: -5px;
                background: var(--primary);
                color: white;
                font-size: 0.7rem;
                min-width: 18px;
                height: 18px;
                border-radius: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
            }
            
            .wishlist-btn {
                background: none;
                border: 2px solid rgba(255,255,255,0.3);
                color: white;
                padding: 0.5rem 1rem;
                border-radius: 30px;
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                transition: var(--transition);
                display: flex;
                align-items: center;
                gap: 0.5rem;
                margin-left: 1rem;
            }
            
            .wishlist-btn.active {
                background: var(--primary);
                border-color: var(--primary);
            }
            
            .wishlist-btn:hover {
                border-color: var(--primary);
                background: rgba(229, 9, 20, 0.2);
            }
            
            .wishlist-btn svg {
                width: 20px;
                height: 20px;
            }
            
            .remove-wishlist-btn {
                background: rgba(229, 9, 20, 0.8) !important;
                color: white;
                border: none;
                padding: 0.5rem 1rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                transition: var(--transition);
                margin-top: 0.5rem;
            }
            
            .remove-wishlist-btn:hover {
                background: var(--primary) !important;
                transform: scale(1.05);
            }
            
            .continue-watching-section {
                margin-bottom: 3rem;
                position: relative;
            }
            
            .continue-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                gap: 1.5rem;
            }
            
            .continue-card {
                position: relative;
                border-radius: var(--border-radius);
                overflow: hidden;
                cursor: pointer;
                transition: var(--transition);
            }
            
            .continue-card:hover {
                transform: translateY(-8px);
            }
            
            .continue-poster {
                position: relative;
                aspect-ratio: 16/9;
                overflow: hidden;
            }
            
            .continue-poster img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: var(--transition);
            }
            
            .continue-card:hover .continue-poster img {
                transform: scale(1.05);
            }
            
            .continue-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 4px;
                background: rgba(255,255,255,0.3);
            }
            
            .continue-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--primary), #ff6b6b);
                transition: width 0.3s ease;
            }
            
            .continue-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: var(--overlay);
                display: flex;
                justify-content: center;
                align-items: center;
                opacity: 0;
                transition: var(--transition);
            }
            
            .continue-card:hover .continue-overlay {
                opacity: 1;
            }
            
            .continue-play-btn {
                background: linear-gradient(135deg, var(--primary), #ff6b6b);
                color: white;
                border: none;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transform: scale(0.8);
                transition: var(--transition);
                box-shadow: 0 4px 15px rgba(229, 9, 20, 0.4);
            }
            
            .continue-card:hover .continue-play-btn {
                transform: scale(1);
            }
            
            .continue-info {
                padding: 0.8rem;
                background: var(--bg-card);
            }
            
            .continue-title {
                font-size: 0.9rem;
                font-weight: 600;
                margin-bottom: 0.3rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .continue-meta {
                font-size: 0.8rem;
                color: var(--text-secondary);
            }
            
            .continue-remove {
                position: absolute;
                top: 10px;
                right: 10px;
                background: rgba(0,0,0,0.7);
                color: white;
                border: none;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                opacity: 0;
                transition: var(--transition);
                z-index: 10;
            }
            
            .continue-card:hover .continue-remove {
                opacity: 1;
            }
            
            .continue-remove:hover {
                background: var(--primary);
            }
            
            .empty-section {
                text-align: center;
                padding: 3rem;
                background: var(--bg-card);
                border-radius: var(--border-radius);
                color: var(--text-secondary);
            }
            
            .empty-section svg {
                width: 60px;
                height: 60px;
                margin-bottom: 1rem;
                opacity: 0.5;
            }
            
            .empty-section h3 {
                font-size: 1.5rem;
                margin-bottom: 0.5rem;
                color: white;
            }
            
            .empty-section p {
                margin-bottom: 1.5rem;
            }
            
            .empty-section button {
                background: var(--primary);
                color: white;
                border: none;
                padding: 0.8rem 2rem;
                border-radius: 30px;
                font-weight: 600;
                cursor: pointer;
                transition: var(--transition);
            }
            
            .empty-section button:hover {
                background: var(--primary-hover);
                transform: scale(1.05);
            }
            
            .resume-badge {
                position: absolute;
                top: 10px;
                left: 10px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 0.3rem 0.8rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                z-index: 10;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            }
            
            .detail-back-btn {
                position: absolute;
                top: 100px;
                left: 2rem;
                background: rgba(0,0,0,0.6);
                color: white;
                border: none;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: var(--transition);
                z-index: 100;
                backdrop-filter: blur(5px);
                border: 1px solid rgba(255,255,255,0.2);
            }
            
            .detail-back-btn:hover {
                background: var(--primary);
                transform: scale(1.1);
            }
            
            .detail-back-btn svg {
                width: 24px;
                height: 24px;
            }
            
            @media (max-width: 768px) {
                .detail-back-btn {
                    top: 80px;
                    left: 1rem;
                    width: 40px;
                    height: 40px;
                }
                
                .detail-back-btn svg {
                    width: 20px;
                    height: 20px;
                }
            }
            
            #playIcon, #pauseIcon {
                transition: opacity 0.2s ease;
            }
            
            #playIcon.hidden, #pauseIcon.hidden {
                display: none;
            }
            
            .fallback-image {
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-secondary);
                font-size: 0.9rem;
                text-align: center;
                padding: 1rem;
            }
            
            .error-message {
                text-align: center;
                padding: 3rem;
                color: var(--text-secondary);
            }
            
            .no-results {
                text-align: center;
                padding: 3rem;
                color: var(--text-secondary);
            }
            
            .video-container {
                position: relative;
                width: 100%;
                height: 100%;
            }
            
            #videoPlayer {
                width: 100%;
                height: 100%;
            }
            
            /* Fix for mobile screen freeze */
            body.player-active {
                overflow: hidden;
                position: fixed;
                width: 100%;
                height: 100%;
                touch-action: none;
            }
            
            body.player-active #videoPlayerOverlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9999;
            }
            
            /* Ensure smooth transitions */
            #videoPlayerOverlay {
                transition: opacity 0.3s ease;
                will-change: opacity;
            }
            
            #videoPlayerOverlay.active {
                opacity: 1;
                pointer-events: all;
            }
        `;
        document.head.appendChild(style);
    }
    
    setupTrailerModal() {
        if (!document.getElementById('trailerModal')) {
            const modalHtml = `
                <div class="trailer-modal" id="trailerModal">
                    <div class="trailer-modal-content">
                        <div class="trailer-modal-header">
                            <h3>Watch Trailer</h3>
                            <button class="trailer-close-btn" id="closeTrailerBtn">&times;</button>
                        </div>
                        <div class="trailer-modal-body">
                            <iframe id="trailerIframe" width="100%" height="400" frameborder="0" allowfullscreen></iframe>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            this.addTrailerModalStyles();
            
            document.getElementById('closeTrailerBtn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeTrailer();
            });
            
            document.getElementById('trailerModal').addEventListener('click', (e) => {
                if (e.target === document.getElementById('trailerModal')) {
                    this.closeTrailer();
                }
            });
            
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && document.getElementById('trailerModal').classList.contains('active')) {
                    this.closeTrailer();
                }
            });
        }
    }
    
    addTrailerModalStyles() {
        if (document.getElementById('trailer-modal-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'trailer-modal-styles';
        style.textContent = `
            .trailer-modal {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.95);
                z-index: 2000;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(10px);
            }
            
            .trailer-modal.active {
                display: flex;
            }
            
            .trailer-modal-content {
                background: var(--bg-secondary);
                border-radius: 16px;
                width: 90%;
                max-width: 900px;
                overflow: hidden;
                animation: modalSlideUp 0.3s ease;
            }
            
            @keyframes modalSlideUp {
                from {
                    opacity: 0;
                    transform: translateY(50px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .trailer-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem;
                background: var(--bg-card);
                border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            
            .trailer-modal-header h3 {
                color: white;
                font-size: 1.2rem;
            }
            
            .trailer-close-btn {
                background: none;
                border: none;
                color: var(--text-secondary);
                font-size: 2rem;
                cursor: pointer;
                line-height: 1;
                padding: 0 0.5rem;
                transition: var(--transition);
            }
            
            .trailer-close-btn:hover {
                color: var(--primary);
            }
            
            .trailer-modal-body {
                padding: 1.5rem;
            }
            
            .trailer-modal-body iframe {
                border-radius: 8px;
                aspect-ratio: 16/9;
                width: 100%;
            }
            
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                background: var(--bg-card);
                color: white;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transform: translateX(120%);
                transition: transform 0.3s ease;
                z-index: 1500;
                display: flex;
                align-items: center;
                gap: 1rem;
            }
            
            .notification.show {
                transform: translateX(0);
            }
            
            .notification.error {
                background: #e50914;
            }
            
            .notification.warning {
                background: #f5a623;
            }
            
            .notification.success {
                background: #2ecc71;
            }
            
            .notification-close {
                background: none;
                border: none;
                color: white;
                font-size: 1.5rem;
                cursor: pointer;
                padding: 0 0.5rem;
            }
            
            .watch-trailer-btn {
                background: rgba(255,255,255,0.2);
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                padding: 1rem 2rem;
                border-radius: 30px;
                font-size: 1.1rem;
                font-weight: 600;
                cursor: pointer;
                transition: var(--transition);
                margin-left: 1rem;
            }
            
            .watch-trailer-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.05);
            }
            
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(5px);
                z-index: 1999;
                display: none;
                justify-content: center;
                align-items: center;
            }
            
            .loading-overlay.active {
                display: flex;
            }
            
            .loading-spinner {
                width: 50px;
                height: 50px;
                border: 3px solid rgba(255,255,255,0.3);
                border-top-color: var(--primary);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
    
    closeTrailer() {
        const modal = document.getElementById('trailerModal');
        const iframe = document.getElementById('trailerIframe');
        if (iframe) iframe.src = '';
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
    }
    
    async checkBackendHealth() {
        try {
            const response = await fetch(`${this.backendUrl}/health`);
            
            if (response.ok) {
                const data = await response.json();
                // Silent success
            } else {
                this.showNotification('Backend not responding. Make sure server.js is running on port 3005', 'warning');
            }
        } catch (error) {
            this.showNotification('Backend connection failed. Run: node server.js', 'error');
        }
    }
    
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button class="notification-close">&times;</button>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 100);
        
        notification.querySelector('.notification-close').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        });
        
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }
        }, 5000);
    }
    
    setupNavigation() {
        document.querySelectorAll('[data-nav]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const view = e.target.closest('[data-nav]').dataset.nav;
                this.navigateTo(view);
            });
        });
        
        window.addEventListener('popstate', () => {
            this.handleRoute();
        });
    }
    
    setupSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;
        
        // Create search history dropdown
        const searchContainer = searchInput.parentElement;
        searchContainer.classList.add('search-container');
        
        const historyDropdown = document.createElement('div');
        historyDropdown.id = 'searchHistory';
        historyDropdown.className = 'search-history-dropdown';
        searchContainer.appendChild(historyDropdown);
        
        let debounceTimer;
        
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();
            
            if (query.length > 0) {
                this.showSearchHistory();
            } else {
                this.hideSearchHistory();
            }
            
            debounceTimer = setTimeout(() => {
                if (query.length > 2) {
                    this.search(query);
                    this.addToSearchHistory(query);
                    this.hideSearchHistory();
                } else if (query.length === 0) {
                    this.handleRoute();
                }
            }, 500);
        });
        
        searchInput.addEventListener('focus', () => {
            if (this.searchHistory.length > 0) {
                this.renderSearchHistory();
                this.showSearchHistory();
            }
        });
        
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = e.target.value.trim();
                if (query.length > 2) {
                    this.search(query);
                    this.addToSearchHistory(query);
                    this.hideSearchHistory();
                }
            }
        });
        
        // Click outside to hide
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target)) {
                this.hideSearchHistory();
            }
        });
    }
    
    setupPlayer() {
        this.player = document.getElementById('videoPlayer');
        if (!this.player) return;
        
        const playPauseBtn = document.getElementById('playPauseBtn');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePlayPause();
            });
        }
        
        const volumeBtn = document.getElementById('volumeBtn');
        if (volumeBtn) {
            volumeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleVolumeSlider();
            });
        }
        
        const volumeSlider = document.getElementById('volumeSlider');
        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                e.preventDefault();
                this.setVolume(e.target.value);
            });
        }
        
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        if (fullscreenBtn) {
            // Remove old listener and add new one with proper handling
            const newFullscreenBtn = fullscreenBtn.cloneNode(true);
            fullscreenBtn.parentNode.replaceChild(newFullscreenBtn, fullscreenBtn);
            
            newFullscreenBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleFullscreen();
            });
        }
        
        const closePlayerBtn = document.getElementById('closePlayerBtn');
        if (closePlayerBtn) {
            // Remove old listener and add new one with proper handling
            const newClosePlayerBtn = closePlayerBtn.cloneNode(true);
            closePlayerBtn.parentNode.replaceChild(newClosePlayerBtn, closePlayerBtn);
            
            newClosePlayerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closePlayer();
            });
        }
        
        const progressContainer = document.getElementById('progressBarContainer');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.seek(e);
            });
        }
        
        this.player.addEventListener('timeupdate', () => this.updateProgress());
        this.player.addEventListener('loadedmetadata', () => this.updateDuration());
        this.player.addEventListener('waiting', () => this.showCinematicLoader());
        this.player.addEventListener('playing', () => {
            this.hideCinematicLoader();
            this.isPlaying = true;
            this.updatePlayPauseIcon();
            
            // Setup mobile controls auto-hide when video starts playing
            this.setupMobileControlsAutoHide();
        });
        this.player.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayPauseIcon();
            
            // Show controls when paused
            const controls = document.querySelector('.video-controls');
            if (controls) {
                controls.classList.remove('hidden');
                this.isControlsVisible = true;
            }
        });
        this.player.addEventListener('error', (e) => this.handlePlayerError(e));
        this.player.addEventListener('ended', () => this.handleVideoEnded());
        
        const prevEpisodeBtn = document.getElementById('prevEpisodeBtn');
        if (prevEpisodeBtn) {
            prevEpisodeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.navigateEpisode(-1);
            });
        }
        
        const nextEpisodeBtn = document.getElementById('nextEpisodeBtn');
        if (nextEpisodeBtn) {
            nextEpisodeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.navigateEpisode(1);
            });
        }
        
        const retryBtn = document.getElementById('retryPlaybackBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.retryPlayback();
            });
        }
        
        const goBackBtn = document.getElementById('goBackBtn');
        if (goBackBtn) {
            goBackBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closePlayer();
            });
        }
        
        this.setupQualityMenu();
        this.setupLanguageMenu();
        
        this.addWatermark();
    }
    
    // Updated closePlayer method with proper fullscreen handling
    closePlayer() {
        // First, exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen()
                .then(() => {
                    this.handleFullscreenExit();
                    this.forceCleanup();
                })
                .catch(() => {
                    this.forceCleanup();
                });
        } else {
            this.forceCleanup();
        }
    }
    
    addWatermark() {
        const container = document.querySelector('.video-container');
        if (!container) return;
        
        // Check if watermark already exists
        if (container.querySelector('.lumiflix-watermark')) return;
        
        const watermark = document.createElement('div');
        watermark.className = 'lumiflix-watermark';
        watermark.textContent = 'LUMIFLIX';
        container.appendChild(watermark);
        
        // Add content info overlay
        this.addEnhancedContentInfoOverlay(container);
    }
    
    addContentInfoOverlay(container) {
        // Use enhanced version instead
        this.addEnhancedContentInfoOverlay(container);
    }
    
    updatePlayPauseIcon() {
        const playIcon = document.getElementById('playIcon');
        const pauseIcon = document.getElementById('pauseIcon');
        
        if (!playIcon || !pauseIcon) return;
        
        if (this.isPlaying) {
            playIcon.classList.add('hidden');
            pauseIcon.classList.remove('hidden');
        } else {
            playIcon.classList.remove('hidden');
            pauseIcon.classList.add('hidden');
        }
    }
    
    handleVideoEnded() {
        if (this.currentMedia && this.currentMedia.media_type === 'tv' && this.currentEpisode) {
            this.navigateEpisode(1);
        } else {
            this.showNotification('Playback completed', 'info');
            
            if (this.currentMedia) {
                const key = this.currentMedia.media_type === 'movie' 
                    ? `movie-${this.currentMedia.id}`
                    : `tv-${this.currentMedia.id}-s${this.currentEpisode.season}e${this.currentEpisode.episode}`;
                delete this.watchProgress[key];
                this.saveProgress();
            }
            
            this.isPlaying = false;
            this.updatePlayPauseIcon();
        }
    }
    
    setupQualityMenu() {
        const qualities = ['Auto', '1080p', '720p', '480p'];
        const menu = document.getElementById('qualityMenu');
        if (!menu) return;
        
        menu.innerHTML = '';
        
        qualities.forEach(quality => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.textContent = quality;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('#qualityMenu .dropdown-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const qualityText = document.querySelector('.quality-text');
                if (qualityText) qualityText.textContent = quality;
            });
            menu.appendChild(item);
        });
    }
    
    setupLanguageMenu() {
        const languages = ['English', 'Spanish', 'French', 'German'];
        const menu = document.getElementById('languageMenu');
        if (!menu) return;
        
        menu.innerHTML = '';
        
        languages.forEach(lang => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.textContent = lang;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('#languageMenu .dropdown-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const languageText = document.querySelector('.language-text');
                if (languageText) languageText.textContent = lang.substring(0, 2).toUpperCase();
            });
            menu.appendChild(item);
        });
    }
    
    togglePlayPause() {
        if (!this.player) return;
        
        if (this.player.paused) {
            this.player.play()
                .then(() => {
                    this.isPlaying = true;
                    this.updatePlayPauseIcon();
                })
                .catch(error => {
                    this.showErrorPanel('Playback Error', 'Unable to play video');
                });
        } else {
            this.player.pause();
            this.isPlaying = false;
            this.updatePlayPauseIcon();
        }
    }
    
    toggleVolumeSlider() {
        const container = document.getElementById('volumeSliderContainer');
        if (container) container.classList.toggle('visible');
    }
    
    setVolume(value) {
        if (this.player) {
            this.player.volume = value;
            const volumeSlider = document.getElementById('volumeSlider');
            if (volumeSlider) volumeSlider.value = value;
        }
    }
    
    seek(e) {
        if (!this.player || !this.player.duration) return;
        
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        this.player.currentTime = pos * this.player.duration;
    }
    
    updateProgress() {
        if (!this.player || !this.player.duration) return;
        
        const playedPercent = (this.player.currentTime / this.player.duration) * 100;
        const buffered = this.player.buffered;
        let bufferedPercent = 0;
        
        if (buffered.length > 0) {
            bufferedPercent = (buffered.end(buffered.length - 1) / this.player.duration) * 100;
        }
        
        const progressPlayed = document.getElementById('progressPlayed');
        const progressBuffered = document.getElementById('progressBuffered');
        const progressHandle = document.getElementById('progressHandle');
        const timeDisplay = document.getElementById('timeDisplay');
        
        if (progressPlayed) progressPlayed.style.width = `${playedPercent}%`;
        if (progressBuffered) progressBuffered.style.width = `${bufferedPercent}%`;
        if (progressHandle) progressHandle.style.left = `${playedPercent}%`;
        
        const current = this.formatTime(this.player.currentTime);
        const duration = this.formatTime(this.player.duration);
        if (timeDisplay) timeDisplay.textContent = `${current} / ${duration}`;
        
        // Save progress every 30 seconds
        if (this.currentMedia && this.player.currentTime > 30) {
            this.saveProgress();
        }
    }
    
    updateDuration() {
        if (!this.player) return;
        
        const timeDisplay = document.getElementById('timeDisplay');
        if (timeDisplay) {
            timeDisplay.textContent = `0:00 / ${this.formatTime(this.player.duration)}`;
        }
    }
    
    formatTime(seconds) {
        if (isNaN(seconds) || seconds === 0) return '0:00';
        
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }
    
    showCinematicLoader() {
        const loader = document.getElementById('cinematicLoader');
        if (!loader) return;
        
        loader.style.opacity = '1';
        loader.classList.remove('hidden');
    }
    
    hideCinematicLoader() {
        const loader = document.getElementById('cinematicLoader');
        if (!loader) return;
        
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.classList.add('hidden');
        }, 500);
    }
    
    handlePlayerError(event) {
        this.hideCinematicLoader();
        this.showErrorPanel('Playback Error', 'Unable to play this content. The stream might be unavailable or require a different source.');
        
        this.isPlaying = false;
        this.updatePlayPauseIcon();
    }
    
    showErrorPanel(title, message) {
        const errorTitle = document.getElementById('errorTitle');
        const errorMessage = document.getElementById('errorMessage');
        const errorPanel = document.getElementById('errorPanel');
        
        if (errorTitle) errorTitle.textContent = title;
        if (errorMessage) errorMessage.textContent = message;
        if (errorPanel) errorPanel.classList.remove('hidden');
    }
    
    hideErrorPanel() {
        const errorPanel = document.getElementById('errorPanel');
        if (errorPanel) errorPanel.classList.add('hidden');
    }
    
    async retryPlayback() {
        this.hideErrorPanel();
        this.showCinematicLoader();
        
        if (this.currentMedia) {
            if (this.currentMedia.media_type === 'movie') {
                await this.playMovie(this.currentMedia.id);
            } else {
                await this.playEpisode(this.currentMedia.id, this.currentEpisode.season, this.currentEpisode.episode);
            }
        }
    }
    
    navigateEpisode(direction) {
        if (!this.currentMedia || !this.currentEpisode) return;
        
        const episodes = this.currentMedia.episodes || [];
        const currentIndex = episodes.findIndex(
            e => e.season === this.currentEpisode.season && e.episode === this.currentEpisode.episode
        );
        
        if (currentIndex === -1) return;
        
        const nextIndex = currentIndex + direction;
        if (nextIndex >= 0 && nextIndex < episodes.length) {
            const nextEpisode = episodes[nextIndex];
            this.playEpisode(this.currentMedia.id, nextEpisode.season, nextEpisode.episode);
        }
    }
    
    async fetchWithBackend(endpoint) {
        const url = `${this.backendUrl}${endpoint}`;
        
        try {
            const response = await fetch(url);
            return response;
        } catch (error) {
            throw error;
        }
    }
    
    // ============== PROGRESS FUNCTIONS ==============
    
    saveProgress() {
        if (!this.currentMedia) return;
        
        if (this.currentMedia.media_type === 'movie') {
            const key = `movie-${this.currentMedia.id}`;
            this.watchProgress[key] = Math.floor(this.player.currentTime);
        } else if (this.currentEpisode) {
            const key = `tv-${this.currentMedia.id}-s${this.currentEpisode.season}e${this.currentEpisode.episode}`;
            this.watchProgress[key] = Math.floor(this.player.currentTime);
        }
        
        localStorage.setItem('lumiflix_progress', JSON.stringify(this.watchProgress));
    }
    
    loadProgress() {
        try {
            return JSON.parse(localStorage.getItem('lumiflix_progress')) || {};
        } catch {
            return {};
        }
    }
    
    getProgressForMovie(id) {
        return this.watchProgress[`movie-${id}`] || 0;
    }
    
    getProgressForEpisode(showId, season, episode) {
        return this.watchProgress[`tv-${showId}-s${season}e${episode}`] || 0;
    }
    
    // ============== WISHLIST FUNCTIONS ==============
    
    loadWishlist() {
        try {
            return JSON.parse(localStorage.getItem('lumiflix_wishlist')) || [];
        } catch {
            return [];
        }
    }
    
    saveWishlist() {
        localStorage.setItem('lumiflix_wishlist', JSON.stringify(this.wishlist));
        this.updateWishlistCount();
    }
    
    updateWishlistCount() {
        const countEl = document.getElementById('wishlistCount');
        if (countEl) {
            countEl.textContent = this.wishlist.length;
        }
    }
    
    toggleWishlist(item) {
        // Comprehensive validation
        if (!item) {
            return;
        }
        
        if (!item.id) {
            return;
        }
        
        if (!item.media_type) {
            return;
        }
        
        const index = this.wishlist.findIndex(w => w.id === item.id && w.media_type === item.media_type);
        
        if (index === -1) {
            // Add to wishlist with all required fields
            this.wishlist.push({
                id: item.id,
                title: item.title || item.name || 'Unknown',
                poster_path: item.poster_path || null,
                media_type: item.media_type,
                year: (item.release_date || item.first_air_date || '').substring(0, 4),
                vote_average: item.vote_average || 0,
                addedAt: Date.now()
            });
            this.showNotification('Added to wishlist', 'success');
            
            // Update the wishlist button immediately
            const wishlistBtn = document.getElementById('detailWishlistBtn');
            if (wishlistBtn) {
                wishlistBtn.classList.add('active');
                wishlistBtn.innerHTML = '❤️ In Wishlist';
            }
        } else {
            // Remove from wishlist
            this.wishlist.splice(index, 1);
            this.showNotification('Removed from wishlist', 'info');
            
            // Update the wishlist button immediately
            const wishlistBtn = document.getElementById('detailWishlistBtn');
            if (wishlistBtn) {
                wishlistBtn.classList.remove('active');
                wishlistBtn.innerHTML = '🤍 Add to Wishlist';
            }
        }
        
        this.saveWishlist();
    }
    
    isInWishlist(id, media_type) {
        return this.wishlist.some(w => w.id === id && w.media_type === media_type);
    }
    
    async showWishlist() {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;
        
        if (this.wishlist.length === 0) {
            mainContent.innerHTML = `
                <div class="empty-section">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                    <h3>Your Wishlist is Empty</h3>
                    <p>Click the heart icon on any movie or TV show to add it to your wishlist</p>
                    <button onclick="app.navigateTo('movies')">Browse Movies</button>
                    <button onclick="app.navigateTo('tv')" style="margin-left: 1rem; background: rgba(255,255,255,0.2);">Browse TV Shows</button>
                </div>
            `;
            return;
        }
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Loading your wishlist...</div>';
        
        try {
            // Fetch details for all wishlist items
            const items = await Promise.all(
                this.wishlist.map(async (item) => {
                    try {
                        const data = await this.fetchFromTMDB(`/${item.media_type}/${item.id}`);
                        return { ...item, ...data };
                    } catch {
                        return item;
                    }
                })
            );
            
            let html = '<h1 class="page-title" style="margin-bottom: 2rem;">My Wishlist</h1>';
            html += '<div class="movie-grid" id="wishlistGrid">';
            
            items.forEach(item => {
                html += this.renderWishlistCard(item);
            });
            
            html += '</div>';
            mainContent.innerHTML = html;
            
            // Attach click handlers
            this.attachWishlistCardHandlers();
            
        } catch (error) {
            mainContent.innerHTML = '<div class="error-message">Failed to load wishlist</div>';
        }
    }
    
    renderWishlistCard(item) {
        const poster = item.poster_path
            ? `${this.tmdbImageBase}w342${item.poster_path}`
            : '';
        
        const title = this.escapeHtml(item.title || item.name || 'Unknown');
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const year = this.escapeHtml(item.year || (item.release_date || item.first_air_date || '').substring(0, 4) || '');
        
        return `
            <div class="movie-card" data-id="${item.id}" data-type="${item.media_type}">
                <div class="card-poster">
                    <img class="poster-img" src="${poster}" alt="${title}" loading="lazy" onerror="this.handleImageError(this, '${title}')">
                    <div class="card-overlay">
                        <button class="watch-now-btn">Watch Now</button>
                        <button class="remove-wishlist-btn">Remove</button>
                    </div>
                    <div class="card-rating">
                        <span class="rating-star">★</span>
                        <span class="rating-value">${rating}</span>
                    </div>
                </div>
                <div class="card-info">
                    <h3 class="card-title">${title}</h3>
                    <div class="card-meta">
                        <span class="card-year">${year}</span>
                        <span class="card-type">${item.media_type === 'movie' ? 'Movie' : 'TV'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    handleImageError(img, title) {
        // Better image error handling
        if (!img) return;
        
        // Create fallback element
        const fallback = document.createElement('div');
        fallback.className = 'crew-image-fallback';
        fallback.textContent = title ? title.charAt(0).toUpperCase() : '?';
        
        // Replace img with fallback
        img.parentNode.replaceChild(fallback, img);
    }
    
    attachWishlistCardHandlers() {
        document.querySelectorAll('#wishlistGrid .movie-card').forEach(card => {
            // Card click - navigate to detail
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Don't navigate if clicking on buttons
                if (e.target.classList.contains('watch-now-btn') || 
                    e.target.classList.contains('remove-wishlist-btn') ||
                    e.target.closest('.watch-now-btn') || 
                    e.target.closest('.remove-wishlist-btn')) {
                    return;
                }
                
                const id = card.dataset.id;
                const type = card.dataset.type;
                if (id && type) {
                    this.navigateToDetail(parseInt(id), type);
                }
            });
            
            // Watch Now button
            const watchBtn = card.querySelector('.watch-now-btn');
            if (watchBtn) {
                watchBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const id = card.dataset.id;
                    const type = card.dataset.type;
                    if (id && type) {
                        this.navigateToDetail(parseInt(id), type);
                    }
                });
            }
            
            // Remove button
            const removeBtn = card.querySelector('.remove-wishlist-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const id = parseInt(card.dataset.id);
                    const type = card.dataset.type;
                    
                    const item = this.wishlist.find(w => w.id === id && w.media_type === type);
                    if (item) {
                        this.toggleWishlist(item);
                        card.remove();
                        
                        // If wishlist becomes empty, show empty state
                        if (this.wishlist.length === 0) {
                            this.showWishlist();
                        }
                    }
                });
            }
        });
    }
    
    // ============== CONTINUE WATCHING FUNCTIONS ==============
    
    getContinueWatching() {
        const continueItems = [];
        
        for (const [key, progress] of Object.entries(this.watchProgress)) {
            if (progress < 10) continue;
            
            const parts = key.split('-');
            if (parts[0] === 'movie') {
                continueItems.push({
                    id: parseInt(parts[1]),
                    media_type: 'movie',
                    progress,
                    key
                });
            } else if (parts[0] === 'tv') {
                const showId = parseInt(parts[1]);
                const seasonMatch = key.match(/s(\d+)e(\d+)/);
                if (seasonMatch) {
                    continueItems.push({
                        id: showId,
                        media_type: 'tv',
                        season: parseInt(seasonMatch[1]),
                        episode: parseInt(seasonMatch[2]),
                        progress,
                        key
                    });
                }
            }
        }
        
        // Sort by most recent (assuming keys are stored with timestamps or by order)
        return continueItems.reverse();
    }
    
    async renderContinueWatching() {
        const continueItems = this.getContinueWatching();
        
        if (continueItems.length === 0) return '';
        
        let html = `
            <section class="section continue-watching-section">
                <div class="section-header">
                    <h2 class="section-title">Continue Watching</h2>
                    <span class="section-count">${continueItems.length} items</span>
                </div>
                <div class="continue-grid" id="continueGrid">
        `;
        
        const itemsToShow = continueItems.slice(0, 10);
        
        for (const item of itemsToShow) {
            try {
                const data = await this.fetchFromTMDB(`/${item.media_type}/${item.id}`);
                html += this.renderContinueCard(item, data);
            } catch {
                // Skip if can't load
            }
        }
        
        html += '</div></section>';
        return html;
    }
    
    renderContinueCard(item, data) {
        const poster = data.backdrop_path
            ? `${this.tmdbImageBase}w500${data.backdrop_path}`
            : data.poster_path 
                ? `${this.tmdbImageBase}w342${data.poster_path}`
                : '';
        
        const title = this.escapeHtml(data.title || data.name || 'Unknown');
        const runtime = data.runtime || 120;
        const progressPercent = Math.min((item.progress / (runtime * 60)) * 100, 100);
        
        let meta = '';
        let resumeText = '';
        if (item.media_type === 'tv') {
            meta = `S${item.season}:E${item.episode}`;
            resumeText = `Resume S${item.season} E${item.episode}`;
        } else {
            meta = this.formatTime(item.progress) + ' / ' + this.formatTime(runtime * 60);
            resumeText = `Resume at ${this.formatTime(item.progress)}`;
        }
        
        return `
            <div class="continue-card" data-id="${item.id}" data-type="${item.media_type}" data-season="${item.season || ''}" data-episode="${item.episode || ''}" data-key="${item.key}">
                <div class="continue-poster">
                    <img src="${poster}" alt="${title}" loading="lazy" onerror="this.handleImageError(this, '${title}')">
                    <div class="continue-progress">
                        <div class="continue-progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                    <div class="continue-overlay">
                        <button class="continue-play-btn" title="${resumeText}">
                            <svg viewBox="0 0 24 24" width="30" height="30">
                                <path fill="currentColor" d="M8 5v14l11-7z"/>
                            </svg>
                        </button>
                    </div>
                    <button class="continue-remove" title="Remove from continue watching">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                    <div class="continue-watching-badge">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-.5-13v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
                        </svg>
                        <span>${Math.round(progressPercent)}%</span>
                    </div>
                </div>
                <div class="continue-info">
                    <div class="continue-title">${title}</div>
                    <div class="continue-meta">${meta}</div>
                </div>
            </div>
        `;
    }
    
    removeFromContinue(key) {
        delete this.watchProgress[key];
        this.saveProgress();
        this.showNotification('Removed from continue watching', 'info');
        
        const card = document.querySelector(`.continue-card[data-key="${key}"]`);
        if (card) {
            card.remove();
        }
        
        const continueGrid = document.getElementById('continueGrid');
        if (continueGrid && continueGrid.children.length === 0) {
            const section = continueGrid.closest('.continue-watching-section');
            if (section) {
                section.remove();
            }
        }
    }
    
    // ============== PLAYBACK FUNCTIONS ==============
    
    async playMovie(id, resume = true) {
        if (this.isLoading) return;
        this.isLoading = true;
        
        this.showCinematicLoader();
        
        const episodeNav = document.getElementById('episodeNavContainer');
        if (episodeNav) episodeNav.classList.add('hidden');
        
        try {
            const response = await this.fetchWithBackend(`/movie/${id}?server=all`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch stream: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Check different possible response structures
            let stream = null;
            if (data.vixsrc?.streams?.[0]) {
                stream = data.vixsrc.streams[0];
            } else if (data.streams?.[0]) {
                stream = data.streams[0];
            } else if (data.stream) {
                stream = data.stream;
            } else if (data.url) {
                stream = { file: data.url };
            }
            
            if (!stream || !stream.file) {
                throw new Error('No streams available');
            }
            
            // Set current media info
            this.currentMedia = { id, media_type: 'movie' };
            
            await this.initializePlayer(stream);
            
            if (resume) {
                const progress = this.watchProgress[`movie-${id}`];
                if (progress && progress > 30 && this.player) {
                    this.player.currentTime = progress;
                    this.showNotification(`Resuming at ${this.formatTime(progress)}`, 'info');
                }
            }
            
        } catch (error) {
            this.hideCinematicLoader();
            this.showErrorPanel('Stream Unavailable', error.message || 'Unable to load video stream');
        } finally {
            this.isLoading = false;
        }
    }
    
    async playEpisode(showId, season, episode, resume = true) {
        if (this.isLoading) return;
        this.isLoading = true;
        
        this.showCinematicLoader();
        
        const episodeNav = document.getElementById('episodeNavContainer');
        if (episodeNav) episodeNav.classList.remove('hidden');
        
        try {
            const response = await this.fetchWithBackend(`/tv/${showId}?season=${season}&episode=${episode}&server=all`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch stream: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Check different possible response structures
            let stream = null;
            if (data.vixsrc?.streams?.[0]) {
                stream = data.vixsrc.streams[0];
            } else if (data.streams?.[0]) {
                stream = data.streams[0];
            } else if (data.stream) {
                stream = data.stream;
            } else if (data.url) {
                stream = { file: data.url };
            }
            
            if (!stream || !stream.file) {
                throw new Error('No streams available');
            }
            
            // Set current media info
            this.currentMedia = { id: showId, media_type: 'tv' };
            this.currentEpisode = { season, episode };
            
            await this.initializePlayer(stream);
            
            if (resume) {
                const progress = this.watchProgress[`tv-${showId}-s${season}e${episode}`];
                if (progress && progress > 30 && this.player) {
                    this.player.currentTime = progress;
                    this.showNotification(`Resuming at ${this.formatTime(progress)}`, 'info');
                }
            }
            
            // Try to fetch episode details for navigation
            try {
                const episodeData = await this.fetchFromTMDB(`/tv/${showId}/season/${season}/episode/${episode}`);
                if (!this.currentMedia.episodes) this.currentMedia.episodes = [];
                this.currentMedia.episodes.push({
                    season: parseInt(season),
                    episode: parseInt(episode)
                });
            } catch (e) {
                // Ignore if can't fetch
            }
            
        } catch (error) {
            this.hideCinematicLoader();
            this.showErrorPanel('Episode Unavailable', error.message || 'Unable to load this episode');
        } finally {
            this.isLoading = false;
        }
    }
    
    async initializePlayer(stream) {
        return new Promise((resolve, reject) => {
            this.hideErrorPanel();
            
            const overlay = document.getElementById('videoPlayerOverlay');
            if (overlay) {
                overlay.classList.add('active');
            }
            
            // Proper body locking for mobile
            document.body.classList.add('player-active');
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.body.style.height = '100%';
            document.body.style.touchAction = 'none';
            
            this.isPlayerActive = true;
            
            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }
            
            if (!this.player) {
                this.player = document.getElementById('videoPlayer');
            }
            
            if (!this.player) {
                document.body.classList.remove('player-active');
                document.body.style.overflow = '';
                document.body.style.position = '';
                document.body.style.width = '';
                document.body.style.height = '';
                document.body.style.touchAction = '';
                reject(new Error('Video player not found'));
                return;
            }
            
            const timeout = setTimeout(() => {
                reject(new Error('Playback timeout'));
            }, 15000);
            
            // Add content info overlay
            this.addEnhancedContentInfoOverlay(document.querySelector('.video-container'));
            
            // Check if HLS is supported and stream is HLS
            if (typeof Hls !== 'undefined' && Hls.isSupported() && stream.file.includes('.m3u8')) {
                try {
                    this.hls = new Hls({
                        maxBufferLength: 30,
                        maxMaxBufferLength: 60,
                        enableWorker: true,
                    });
                    
                    if (stream.headers) {
                        this.hls.config.xhrSetup = function(xhr) {
                            Object.entries(stream.headers).forEach(([key, value]) => {
                                xhr.setRequestHeader(key, value);
                            });
                        };
                    }
                    
                    this.hls.loadSource(stream.file);
                    this.hls.attachMedia(this.player);
                    
                    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        this.player.play()
                            .then(() => {
                                clearTimeout(timeout);
                                this.hideCinematicLoader();
                                this.isPlaying = true;
                                this.updatePlayPauseIcon();
                                resolve();
                            })
                            .catch((error) => {
                                reject(error);
                            });
                    });
                    
                    this.hls.on(Hls.Events.ERROR, (event, data) => {
                        if (data.fatal) {
                            clearTimeout(timeout);
                            reject(new Error('HLS error: ' + data.type));
                        }
                    });
                } catch (error) {
                    // Fallback to direct playback
                    this.playDirect(stream.file, timeout, resolve, reject);
                }
            } else if (this.player.canPlayType && this.player.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS support
                this.player.src = stream.file;
                this.player.addEventListener('loadedmetadata', () => {
                    this.player.play()
                        .then(() => {
                            clearTimeout(timeout);
                            this.hideCinematicLoader();
                            this.isPlaying = true;
                            this.updatePlayPauseIcon();
                            resolve();
                        })
                        .catch(reject);
                }, { once: true });
                
                this.player.addEventListener('error', () => {
                    clearTimeout(timeout);
                    reject(new Error('Video element error'));
                }, { once: true });
                
            } else {
                // Direct playback for MP4 or other formats
                this.playDirect(stream.file, timeout, resolve, reject);
            }
            
            // Add playing event listener as backup
            this.player.addEventListener('playing', () => {
                clearTimeout(timeout);
                this.hideCinematicLoader();
                this.isPlaying = true;
                this.updatePlayPauseIcon();
                resolve();
            }, { once: true });
        });
    }
    
    playDirect(url, timeout, resolve, reject) {
        if (!this.player) {
            reject(new Error('Player not found'));
            return;
        }
        
        this.player.src = url;
        this.player.load();
        
        const playPromise = this.player.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    clearTimeout(timeout);
                    this.hideCinematicLoader();
                    this.isPlaying = true;
                    this.updatePlayPauseIcon();
                    resolve();
                })
                .catch((error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
        }
    }
    
    // ============== CONTENT LOADING FUNCTIONS ==============
    
    async loadHome() {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Loading LumiFlix...</div>';
        
        try {
            // Use cached content if available and not too old (less than 1 hour)
            const useCache = this.cachedContent.lastUpdate && 
                            (Date.now() - this.cachedContent.lastUpdate) < 3600000;
            
            let trendingMovies, trendingTV, popularMovies, popularTV;
            
            if (useCache && this.cachedContent.trendingMovies) {
                trendingMovies = this.cachedContent.trendingMovies;
                trendingTV = this.cachedContent.trendingTV;
                popularMovies = this.cachedContent.popularMovies;
                popularTV = this.cachedContent.popularTV;
            } else {
                [trendingMovies, trendingTV, popularMovies, popularTV] = await Promise.all([
                    this.fetchFromTMDB('/trending/movie/week'),
                    this.fetchFromTMDB('/trending/tv/week'),
                    this.fetchFromTMDB('/movie/popular'),
                    this.fetchFromTMDB('/tv/popular')
                ]);
                
                // Update cache
                this.cachedContent = {
                    trendingMovies,
                    trendingTV,
                    popularMovies,
                    popularTV,
                    lastUpdate: Date.now()
                };
                this.saveCachedContent();
            }
            
            const continueHtml = await this.renderContinueWatching();
            
            let html = '';
            
            if (trendingMovies.results?.[0]) {
                const hero = trendingMovies.results[0];
                html += this.renderHero(hero);
            }
            
            html += continueHtml;
            
            html += this.renderSection('Trending Movies', trendingMovies.results?.slice(0, 10) || [], 'movie');
            html += this.renderSection('Trending TV Shows', trendingTV.results?.slice(0, 10) || [], 'tv');
            html += this.renderSection('Popular Movies', popularMovies.results?.slice(0, 10) || [], 'movie');
            html += this.renderSection('Popular TV Shows', popularTV.results?.slice(0, 10) || [], 'tv');
            
            mainContent.innerHTML = html;
            
            this.attachCardClickHandlers();
            this.attachContinueCardHandlers();
            
        } catch (error) {
            mainContent.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                    <h2 style="color: #e50914;">Failed to Load Content</h2>
                    <p style="color: #b3b3b3;">${error.message}</p>
                    <button onclick="app.loadHome()" style="background: #e50914; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; margin-top: 1rem; cursor: pointer;">Retry</button>
                </div>
            `;
        }
    }
    
    attachContinueCardHandlers() {
        document.querySelectorAll('.continue-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Don't trigger if clicking remove button
                if (e.target.closest('.continue-remove')) return;
                
                const id = card.dataset.id;
                const type = card.dataset.type;
                const season = card.dataset.season;
                const episode = card.dataset.episode;
                
                if (id && type) {
                    if (type === 'movie') {
                        this.playMovie(parseInt(id), true);
                    } else if (season && episode) {
                        this.playEpisode(parseInt(id), parseInt(season), parseInt(episode), true);
                    } else {
                        this.navigateToDetail(parseInt(id), type);
                    }
                }
            });
            
            const removeBtn = card.querySelector('.continue-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const key = card.dataset.key;
                    this.removeFromContinue(key);
                });
            }
        });
    }
    
    attachCardClickHandlers() {
        document.querySelectorAll('.movie-card:not(#wishlistGrid .movie-card)').forEach(card => {
            // Remove existing listeners by cloning
            const newCard = card.cloneNode(true);
            card.parentNode.replaceChild(newCard, card);
            
            newCard.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (e.target.classList.contains('watch-now-btn') || e.target.closest('.watch-now-btn')) {
                    const id = newCard.dataset.id;
                    const type = newCard.dataset.type;
                    if (id && type) {
                        this.navigateToDetail(parseInt(id), type);
                    }
                    return;
                }
                
                const id = newCard.dataset.id;
                const type = newCard.dataset.type;
                if (id && type) {
                    this.navigateToDetail(parseInt(id), type);
                }
            });
            
            const watchBtn = newCard.querySelector('.watch-now-btn');
            if (watchBtn) {
                watchBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = newCard.dataset.id;
                    const type = newCard.dataset.type;
                    if (id && type) {
                        this.navigateToDetail(parseInt(id), type);
                    }
                });
            }
        });
    }
    
    async loadMovies() {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Loading movies...</div>';
        
        try {
            const data = await this.fetchFromTMDB('/movie/popular');
            let html = '<h1 class="page-title" style="margin-bottom: 2rem;">Popular Movies</h1>';
            html += '<div class="movie-grid" id="movieGrid">';
            
            data.results?.forEach(movie => {
                html += this.renderMovieCard(movie, 'movie');
            });
            
            html += '</div>';
            html += '<div class="infinite-scroll-trigger" id="infiniteTrigger"></div>';
            
            mainContent.innerHTML = html;
            
            this.attachCardClickHandlers();
            
            this.setupInfiniteScroll('movie', '/movie/popular', 2);
            
        } catch (error) {
            mainContent.innerHTML = '<div class="error-message">Failed to load movies</div>';
        }
    }
    
    async loadTVShows() {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Loading TV shows...</div>';
        
        try {
            const data = await this.fetchFromTMDB('/tv/popular');
            let html = '<h1 class="page-title" style="margin-bottom: 2rem;">Popular TV Shows</h1>';
            html += '<div class="movie-grid" id="movieGrid">';
            
            data.results?.forEach(show => {
                html += this.renderMovieCard(show, 'tv');
            });
            
            html += '</div>';
            html += '<div class="infinite-scroll-trigger" id="infiniteTrigger"></div>';
            
            mainContent.innerHTML = html;
            
            this.attachCardClickHandlers();
            
            this.setupInfiniteScroll('tv', '/tv/popular', 2);
            
        } catch (error) {
            mainContent.innerHTML = '<div class="error-message">Failed to load TV shows</div>';
        }
    }
    
    async loadDetail(id, type) {
        // Add loading flag to prevent multiple loads
        if (this.isLoadingDetail) return;
        this.isLoadingDetail = true;
        
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) {
            this.isLoadingDetail = false;
            return;
        }
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Loading details...</div>';
        
        try {
            const [detail, credits, videos] = await Promise.all([
                this.fetchFromTMDB(`/${type}/${id}`),
                this.fetchFromTMDB(`/${type}/${id}/credits`),
                this.fetchFromTMDB(`/${type}/${id}/videos`)
            ]);
            
            // Validate detail object
            if (!detail || !detail.id) {
                throw new Error('Invalid detail data received');
            }
            
            // Ensure media_type is set
            detail.media_type = type;
            
            let html = this.renderDetail(detail, type, credits, videos);
            
            html += `
                <button class="detail-back-btn" id="detailBackBtn">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                </button>
            `;
            
            // Add Crew Section
            if (credits.crew && credits.crew.length > 0) {
                html += this.renderCrewSection(credits.crew);
            }
            
            if (type === 'tv') {
                const seasons = await Promise.all(
                    detail.seasons?.filter(s => s.season_number > 0).map(s => 
                        this.fetchFromTMDB(`/tv/${id}/season/${s.season_number}`)
                    ) || []
                );
                
                html += this.renderSeasons(detail, seasons);
            }
            
            mainContent.innerHTML = html;
            
            // Add back button handler
            const backBtn = document.getElementById('detailBackBtn');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.navigateTo('home');
                });
            }
            
            // Add play button handlers with resume options
            this.addPlayButtonHandlers(id, type, detail);
            
            // Wishlist button handler with proper validation
            const wishlistBtn = document.getElementById('detailWishlistBtn');
            if (wishlistBtn) {
                // Remove any existing listeners by cloning
                const newWishlistBtn = wishlistBtn.cloneNode(true);
                wishlistBtn.parentNode.replaceChild(newWishlistBtn, wishlistBtn);
                
                // Add new click handler
                newWishlistBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Use the detail object which we know is valid
                    if (detail && detail.id) {
                        this.toggleWishlist(detail);
                    } else {
                        this.showNotification('Error: Could not add to wishlist', 'error');
                    }
                });
            }
            
            const trailerBtn = document.getElementById('trailerBtn');
            if (trailerBtn) {
                trailerBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const trailer = videos.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
                    if (trailer) {
                        this.playTrailer(trailer.key);
                    } else {
                        this.showNotification('No trailer available', 'warning');
                    }
                });
            }
            
            // Add crew card click handlers
            document.querySelectorAll('.crew-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const personId = card.dataset.id;
                    const personName = card.dataset.name;
                    this.showPersonDetails(personId, personName);
                });
            });
            
            document.querySelectorAll('.episode-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const season = item.dataset.season;
                    const episode = item.dataset.episode;
                    this.playEpisode(id, parseInt(season), parseInt(episode), true);
                });
                
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const season = item.dataset.season;
                    const episode = item.dataset.episode;
                    this.playEpisode(id, parseInt(season), parseInt(episode), false);
                });
            });
            
            document.querySelectorAll('.season-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const season = btn.dataset.season;
                    
                    document.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    document.querySelectorAll('.episodes-season').forEach(seasonDiv => {
                        if (seasonDiv.dataset.season === season) {
                            seasonDiv.style.display = 'block';
                        } else {
                            seasonDiv.style.display = 'none';
                        }
                    });
                });
            });
            
            // Activate first season button
            const firstSeasonBtn = document.querySelector('.season-btn');
            if (firstSeasonBtn) {
                firstSeasonBtn.classList.add('active');
            }
            
            this.currentMedia = { id, media_type: type, ...detail };
            
        } catch (error) {
            mainContent.innerHTML = '<div class="error-message">Failed to load details</div>';
        } finally {
            // Reset loading flag
            this.isLoadingDetail = false;
        }
    }
    
    renderCrewSection(crew) {
        // Filter and sort crew (directors, writers, producers first)
        const importantRoles = ['Director', 'Writer', 'Producer', 'Executive Producer', 'Creator'];
        const sortedCrew = [...crew].sort((a, b) => {
            const aIndex = importantRoles.indexOf(a.job);
            const bIndex = importantRoles.indexOf(b.job);
            if (aIndex === -1 && bIndex === -1) return 0;
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        }).slice(0, 12); // Show top 12 crew members
        
        let html = `
            <div class="crew-section">
                <h2 class="section-title">Crew</h2>
                <div class="crew-grid">
        `;
        
        sortedCrew.forEach(person => {
            const profilePath = person.profile_path
                ? `${this.tmdbImageBase}w185${person.profile_path}`
                : '';
            
            const name = this.escapeHtml(person.name);
            const job = this.escapeHtml(person.job);
            const department = person.department ? this.escapeHtml(person.department) : '';
            
            html += `
                <div class="crew-card" data-id="${person.id}" data-name="${name}">
                    ${profilePath ? 
                        `<img class="crew-image" src="${profilePath}" alt="${name}" loading="lazy" onerror="this.onerror=null; this.parentNode.innerHTML='<div class=\\'crew-image-fallback\\'>${name.charAt(0)}</div>'">` :
                        `<div class="crew-image-fallback">${name.charAt(0)}</div>`
                    }
                    <div class="crew-info">
                        <div class="crew-name">${name}</div>
                        <div class="crew-role">${job}</div>
                        ${department ? `<div class="crew-character">${department}</div>` : ''}
                    </div>
                </div>
            `;
        });
        
        html += '</div></div>';
        return html;
    }
    
    async showPersonDetails(personId, personName) {
        try {
            const data = await this.fetchFromTMDB(`/person/${personId}`);
            const credits = await this.fetchFromTMDB(`/person/${personId}/combined_credits`);
            
            const modal = document.createElement('div');
            modal.className = 'crew-modal active';
            
            const profilePath = data.profile_path
                ? `${this.tmdbImageBase}w500${data.profile_path}`
                : '';
            
            const birthday = data.birthday ? new Date(data.birthday).toLocaleDateString() : 'Unknown';
            const deathday = data.deathday ? new Date(data.deathday).toLocaleDateString() : null;
            const placeOfBirth = this.escapeHtml(data.place_of_birth || 'Unknown');
            const biography = this.escapeHtml(data.biography || 'No biography available.');
            const name = this.escapeHtml(data.name);
            const knownForDepartment = this.escapeHtml(data.known_for_department || 'Actor');
            
            // Get known for items (top 6)
            const knownFor = credits.cast?.slice(0, 6).map(item => ({
                id: item.id,
                title: this.escapeHtml(item.title || item.name),
                poster: item.poster_path ? `${this.tmdbImageBase}w185${item.poster_path}` : '',
                media_type: item.media_type
            })) || [];
            
            modal.innerHTML = `
                <div class="crew-modal-content">
                    <div class="crew-modal-header">
                        <h2>${name}</h2>
                        <button class="crew-modal-close">&times;</button>
                    </div>
                    <div class="crew-modal-body">
                        <div class="crew-modal-image">
                            ${profilePath ? 
                                `<img src="${profilePath}" alt="${name}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'500\' height=\'750\' viewBox=\'0 0 500 750\'%3E%3Crect width=\'500\' height=\'750\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'250\' y=\'375\' font-family=\'Arial\' font-size=\'24\' fill=\'%23999\' text-anchor=\'middle\'%3E${name.charAt(0)}%3C/text%3E%3C/svg%3E'">` :
                                `<div class="crew-image-fallback" style="width:100%; height:100%; min-height:300px; font-size:4rem;">${name.charAt(0)}</div>`
                            }
                        </div>
                        <div class="crew-modal-details">
                            <h3>${name}</h3>
                            <div class="role">${knownForDepartment}</div>
                            <div class="info-item">
                                <span class="info-label">Born:</span>
                                <span class="info-value">${birthday} ${placeOfBirth ? 'in ' + placeOfBirth : ''}</span>
                            </div>
                            ${deathday ? `
                                <div class="info-item">
                                    <span class="info-label">Died:</span>
                                    <span class="info-value">${deathday}</span>
                                </div>
                            ` : ''}
                            <div class="info-item">
                                <span class="info-label">Known for:</span>
                                <span class="info-value">${knownForDepartment}</span>
                            </div>
                            <div class="bio">${biography.substring(0, 300)}${biography.length > 300 ? '...' : ''}</div>
                            
                            ${knownFor.length > 0 ? `
                                <h4>Known For</h4>
                                <div class="known-for-grid">
                                    ${knownFor.map(item => `
                                        <div class="known-for-item" onclick="app.navigateToDetail(${item.id}, '${item.media_type}'); document.querySelector('.crew-modal.active')?.remove();">
                                            <div class="known-for-poster">
                                                <img src="${item.poster}" alt="${item.title}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'185\' height=\'278\' viewBox=\'0 0 185 278\'%3E%3Crect width=\'185\' height=\'278\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'92\' y=\'139\' font-family=\'Arial\' font-size=\'14\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Image%3C/text%3E%3C/svg%3E'">
                                            </div>
                                            <div class="known-for-title">${item.title}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Add close handlers
            modal.querySelector('.crew-modal-close').addEventListener('click', () => {
                modal.remove();
                document.body.style.overflow = '';
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    document.body.style.overflow = '';
                }
            });
            
            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.body.style.overflow = '';
                    document.removeEventListener('keydown', escHandler);
                }
            });
            
            document.body.style.overflow = 'hidden';
            
        } catch (error) {
            this.showNotification('Failed to load person details', 'error');
        }
    }
    
    addPlayButtonHandlers(id, type, detail) {
        const playBtn = document.getElementById('playBtn');
        if (!playBtn) return;
        
        // Check if there's progress to resume
        let progress = 0;
        if (type === 'movie') {
            progress = this.getProgressForMovie(id);
        }
        
        if (progress > 30) {
            // Replace single play button with resume options
            const playBtnGroup = document.createElement('div');
            playBtnGroup.className = 'play-btn-group';
            
            // Resume button
            const resumeBtn = document.createElement('button');
            resumeBtn.className = 'resume-btn';
            resumeBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M8 5v14l11-7z"/>
                </svg>
                Resume
                <span class="resume-time">${this.formatTime(progress)}</span>
            `;
            resumeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (type === 'movie') {
                    this.playMovie(id, true);
                }
            });
            
            // Restart button
            const restartBtn = document.createElement('button');
            restartBtn.className = 'resume-btn restart';
            restartBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                Play from Start
            `;
            restartBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (type === 'movie') {
                    this.playMovie(id, false);
                }
            });
            
            playBtnGroup.appendChild(resumeBtn);
            playBtnGroup.appendChild(restartBtn);
            
            // Replace the original play button
            playBtn.parentNode.replaceChild(playBtnGroup, playBtn);
        } else {
            // No progress, keep regular play button
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (type === 'movie') {
                    this.playMovie(id, false);
                }
            });
        }
    }
    
    playTrailer(key) {
        const modal = document.getElementById('trailerModal');
        const iframe = document.getElementById('trailerIframe');
        if (modal && iframe) {
            iframe.src = `${this.youtubeBase}${key}?autoplay=1`;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
    
    async search(query) {
        const mainContent = document.getElementById('mainContent');
        if (!mainContent) return;
        
        mainContent.innerHTML = '<div class="loading-sections" style="text-align: center; padding: 3rem;">Searching...</div>';
        
        try {
            const data = await this.fetchFromTMDB(`/search/multi?query=${encodeURIComponent(query)}`);
            
            let html = `<h1 class="page-title" style="margin-bottom: 2rem;">Search Results for "${this.escapeHtml(query)}"</h1>`;
            
            if (!data.results || data.results.length === 0) {
                html += '<p class="no-results">No results found</p>';
            } else {
                html += '<div class="movie-grid">';
                data.results
                    .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                    .forEach(item => {
                        html += this.renderMovieCard(item, item.media_type);
                    });
                html += '</div>';
            }
            
            mainContent.innerHTML = html;
            
            this.attachCardClickHandlers();
            
        } catch (error) {
            mainContent.innerHTML = '<div class="error-message">Search failed</div>';
        }
    }
    
    async fetchFromTMDB(endpoint, page = 1) {
        // Skip if endpoint contains undefined
        if (endpoint.includes('undefined')) {
            return { results: [] };
        }
        
        const url = `${this.tmdbBase}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${this.tmdbApiKey}&page=${page}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`TMDB fetch failed: ${response.status}`);
            return response.json();
        } catch (error) {
            throw error;
        }
    }
    
    renderHero(item) {
        const backdrop = item.backdrop_path 
            ? `${this.tmdbImageBase}original${item.backdrop_path}`
            : '';
        
        const title = this.escapeHtml(item.title || item.name || 'Unknown');
        const overview = this.escapeHtml(item.overview || 'No overview available');
        
        return `
            <div class="hero-section">
                <img class="hero-backdrop" src="${backdrop}" alt="${title}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1920\' height=\'1080\' viewBox=\'0 0 1920 1080\'%3E%3Crect width=\'1920\' height=\'1080\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'960\' y=\'540\' font-family=\'Arial\' font-size=\'24\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Image%3C/text%3E%3C/svg%3E'">
                <div class="hero-overlay"></div>
                <div class="hero-content">
                    <h1 class="hero-title">${title}</h1>
                    <p class="hero-overview">${overview.substring(0, 200)}${overview.length > 200 ? '...' : ''}</p>
                    <button class="hero-btn" onclick="app.navigateToDetail(${item.id}, '${item.title ? 'movie' : 'tv'}')">Watch Now</button>
                </div>
            </div>
        `;
    }
    
    renderSection(title, items, type) {
        if (!items || items.length === 0) return '';
        
        let html = `
            <section class="section">
                <div class="section-header">
                    <h2 class="section-title">${this.escapeHtml(title)}</h2>
                    <a href="#/${type === 'movie' ? 'movies' : 'tv'}" class="section-link">View All →</a>
                </div>
                <div class="movie-grid">
        `;
        
        items.forEach(item => {
            html += this.renderMovieCard(item, type);
        });
        
        html += '</div></section>';
        
        return html;
    }
    
    renderMovieCard(item, type) {
        const poster = item.poster_path
            ? `${this.tmdbImageBase}w342${item.poster_path}`
            : '';
        
        const title = this.escapeHtml(item.title || item.name || 'Unknown');
        const year = this.escapeHtml((item.release_date || item.first_air_date || '').substring(0, 4));
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        
        // Check if there's progress for this item
        let progressBadge = '';
        if (type === 'movie') {
            const progress = this.getProgressForMovie(item.id);
            if (progress > 30 && item.runtime) {
                const percent = Math.round((progress / (item.runtime * 60)) * 100);
                progressBadge = `<div class="resume-badge">${percent}%</div>`;
            }
        }
        
        return `
            <div class="movie-card" data-id="${item.id}" data-type="${type}">
                <div class="card-poster">
                    <img class="poster-img" src="${poster}" alt="${title}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'342\' height=\'513\' viewBox=\'0 0 342 513\'%3E%3Crect width=\'342\' height=\'513\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'171\' y=\'256\' font-family=\'Arial\' font-size=\'14\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Poster%3C/text%3E%3C/svg%3E'">
                    <div class="card-overlay">
                        <button class="watch-now-btn">Watch Now</button>
                    </div>
                    <div class="card-rating">
                        <span class="rating-star">★</span>
                        <span class="rating-value">${rating}</span>
                    </div>
                    ${progressBadge}
                </div>
                <div class="card-info">
                    <h3 class="card-title">${title}</h3>
                    <div class="card-meta">
                        <span class="card-year">${year}</span>
                        <span class="card-type">${type === 'movie' ? 'Movie' : 'TV'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderDetail(item, type, credits, videos) {
        const backdrop = item.backdrop_path
            ? `${this.tmdbImageBase}original${item.backdrop_path}`
            : '';
        
        const poster = item.poster_path
            ? `${this.tmdbImageBase}w500${item.poster_path}`
            : '';
        
        const title = this.escapeHtml(item.title || item.name || 'Unknown');
        const year = this.escapeHtml((item.release_date || item.first_air_date || '').substring(0, 4));
        
        let runtime = '';
        if (type === 'movie') {
            const minutes = item.runtime || 0;
            if (minutes > 0) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                runtime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            } else {
                runtime = '? min';
            }
        } else {
            runtime = `${item.number_of_seasons || '?'} Season${item.number_of_seasons !== 1 ? 's' : ''}`;
        }
        
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const genres = item.genres?.map(g => this.escapeHtml(g.name)).join(', ') || 'Unknown';
        const director = credits.crew?.find(c => c.job === 'Director')?.name || 'Unknown';
        const cast = credits.cast?.slice(0, 5).map(c => this.escapeHtml(c.name)).join(', ') || 'Unknown';
        const hasTrailer = videos.results?.some(v => v.type === 'Trailer' && v.site === 'YouTube');
        const isInWishlist = this.isInWishlist(item.id, type);
        
        let progress = 0;
        let progressPercent = 0;
        if (type === 'movie') {
            progress = this.getProgressForMovie(item.id);
            if (progress > 30 && item.runtime) {
                progressPercent = Math.round((progress / (item.runtime * 60)) * 100);
            }
        }
        
        return `
            <div class="detail-container">
                <div class="backdrop-section">
                    <img class="backdrop-img" src="${backdrop}" alt="${title}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'1920\' height=\'1080\' viewBox=\'0 0 1920 1080\'%3E%3Crect width=\'1920\' height=\'1080\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'960\' y=\'540\' font-family=\'Arial\' font-size=\'24\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Image%3C/text%3E%3C/svg%3E'">
                    <div class="backdrop-overlay"></div>
                    ${progressPercent > 0 ? `<div class="resume-badge">${progressPercent}% Watched</div>` : ''}
                </div>
                
                <div class="detail-header">
                    <div class="detail-poster">
                        <img src="${poster}" alt="${title}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'500\' height=\'750\' viewBox=\'0 0 500 750\'%3E%3Crect width=\'500\' height=\'750\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'250\' y=\'375\' font-family=\'Arial\' font-size=\'16\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Poster%3C/text%3E%3C/svg%3E'">
                    </div>
                    <div class="detail-info">
                        <h1 class="detail-title">${title}</h1>
                        <div class="detail-meta">
                            <span>${year}</span>
                            <span>${runtime}</span>
                            <span>★ ${rating}</span>
                        </div>
                        <p class="detail-overview">${item.overview || 'No overview available'}</p>
                        <div class="detail-actions">
                            <button class="play-btn" id="playBtn">
                                <svg viewBox="0 0 24 24" width="20" height="20">
                                    <path fill="currentColor" d="M8 5v14l11-7z"/>
                                </svg>
                                Play
                            </button>
                            <button class="wishlist-btn ${isInWishlist ? 'active' : ''}" id="detailWishlistBtn">
                                ${isInWishlist ? '❤️' : '🤍'} ${isInWishlist ? 'In Wishlist' : 'Add to Wishlist'}
                            </button>
                            ${hasTrailer ? '<button class="watch-trailer-btn" id="trailerBtn">🎬 Trailer</button>' : ''}
                        </div>
                        <div class="detail-details">
                            <p><strong>Genres:</strong> ${genres}</p>
                            <p><strong>Director:</strong> ${director}</p>
                            <p><strong>Cast:</strong> ${cast}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    renderSeasons(show, seasons) {
        let html = '<div class="episodes-section">';
        
        html += '<div class="season-selector">';
        show.seasons?.forEach(season => {
            if (season.season_number > 0) {
                html += `<button class="season-btn" data-season="${season.season_number}">Season ${season.season_number}</button>`;
            }
        });
        html += '</div>';
        
        seasons.forEach((seasonData, index) => {
            const seasonNum = seasonData.season_number;
            html += `<div class="episodes-season" data-season="${seasonNum}" ${index > 0 ? 'style="display:none"' : ''}>`;
            html += '<div class="episodes-list">';
            
            seasonData.episodes?.forEach(episode => {
                html += this.renderEpisode(episode, seasonNum, show.id);
            });
            
            html += '</div></div>';
        });
        
        html += '</div>';
        return html;
    }
    
    renderEpisode(episode, seasonNum, showId) {
        const still = episode.still_path
            ? `${this.tmdbImageBase}w300${episode.still_path}`
            : '';
        
        let runtime = '';
        if (episode.runtime) {
            const minutes = episode.runtime;
            if (minutes >= 60) {
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                runtime = `${hours}h ${mins}m`;
            } else {
                runtime = `${minutes}m`;
            }
        }
        
        const name = this.escapeHtml(episode.name);
        const overview = this.escapeHtml(episode.overview || 'No overview available');
        const progress = this.getProgressForEpisode(showId, seasonNum, episode.episode_number);
        const progressPercent = progress && episode.runtime ? (progress / (episode.runtime * 60)) * 100 : 0;
        
        return `
            <div class="episode-item" data-season="${seasonNum}" data-episode="${episode.episode_number}">
                <div class="episode-thumbnail">
                    <img src="${still}" alt="${name}" loading="lazy" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'300\' height=\'169\' viewBox=\'0 0 300 169\'%3E%3Crect width=\'300\' height=\'169\' fill=\'%231a1a2e\'/%3E%3Ctext x=\'150\' y=\'84\' font-family=\'Arial\' font-size=\'12\' fill=\'%23999\' text-anchor=\'middle\'%3ENo Image%3C/text%3E%3C/svg%3E'">
                    <div class="episode-play-overlay">
                        <svg viewBox="0 0 24 24" width="32" height="32">
                            <path fill="currentColor" d="M8 5v14l11-7z"/>
                        </svg>
                    </div>
                    ${progress > 30 ? '<div class="episode-resume-badge">Resume</div>' : ''}
                    ${progressPercent > 0 ? `<div class="episode-progress-indicator" style="width: ${progressPercent}%"></div>` : ''}
                </div>
                <div class="episode-details">
                    <div class="episode-header">
                        <span class="episode-number">Episode ${episode.episode_number}</span>
                        <span class="episode-runtime">${runtime}</span>
                    </div>
                    <h4 class="episode-name">${name}</h4>
                    <p class="episode-overview">${overview}</p>
                    <div class="episode-progress-bar">
                        <div class="episode-progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
            </div>
        `;
    }
    
    setupInfiniteScroll(type, endpoint, page) {
        const observer = new IntersectionObserver(async (entries) => {
            if (entries[0].isIntersecting) {
                observer.disconnect();
                
                try {
                    const data = await this.fetchFromTMDB(endpoint, page);
                    
                    let html = '';
                    data.results?.forEach(item => {
                        html += this.renderMovieCard(item, type);
                    });
                    
                    const movieGrid = document.getElementById('movieGrid');
                    if (movieGrid) {
                        movieGrid.insertAdjacentHTML('beforeend', html);
                    }
                    
                    this.attachCardClickHandlers();
                    
                    if (data.page < data.total_pages) {
                        this.setupInfiniteScroll(type, endpoint, page + 1);
                    }
                    
                } catch (error) {
                    // Silent fail for infinite scroll
                }
            }
        }, { threshold: 0.5 });
        
        const trigger = document.getElementById('infiniteTrigger');
        if (trigger) observer.observe(trigger);
    }
    
    navigateTo(view) {
        document.querySelectorAll('[data-nav]').forEach(link => {
            link.classList.toggle('active', link.dataset.nav === view);
        });
        
        window.location.hash = view === 'home' ? '/' : `/${view}`;
    }
    
    handleRoute() {
        const hash = window.location.hash.slice(1) || '/';
        
        if (hash === '/') {
            this.loadHome();
            this.currentView = 'home';
        } else if (hash === '/movies') {
            this.loadMovies();
            this.currentView = 'movies';
        } else if (hash === '/tv') {
            this.loadTVShows();
            this.currentView = 'tv';
        } else if (hash === '/wishlist') {
            this.showWishlist();
            this.currentView = 'wishlist';
        } else if (hash.startsWith('/movie/')) {
            const id = hash.split('/')[2];
            if (id && !isNaN(parseInt(id))) {
                this.loadDetail(parseInt(id), 'movie');
            }
        } else if (hash.startsWith('/tv/')) {
            const id = hash.split('/')[2];
            if (id && !isNaN(parseInt(id))) {
                this.loadDetail(parseInt(id), 'tv');
            }
        }
    }
    
    navigateToDetail(id, type) {
        if (!id || !type) {
            return;
        }
        window.location.hash = `/${type}/${id}`;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new LumiFlix();
});

// Add global image error handler
window.handleImageError = function(img, title) {
    if (!img) return;
    const fallback = document.createElement('div');
    fallback.className = 'crew-image-fallback';
    fallback.textContent = title ? title.charAt(0).toUpperCase() : '?';
    img.parentNode.replaceChild(fallback, img);

};
