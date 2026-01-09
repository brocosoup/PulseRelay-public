/**
 * Now Playing Overlay JavaScript
 * Displays currently playing track from music player
 */

(function() {
  'use strict';

  // Get token from hidden div
  const authData = document.getElementById('authData');
  const token = authData ? authData.dataset.token : '';

  // DOM elements
  const elements = {
    nowPlaying: document.getElementById('nowPlaying'),
    albumArt: document.getElementById('albumArt'),
    trackTitle: document.getElementById('trackTitle'),
    trackArtist: document.getElementById('trackArtist'),
    trackAlbum: document.getElementById('trackAlbum')
  };

  // State
  let currentTrackId = null;
  let isVisible = false;
  let hideTimeout = null;
  let hasBeenShownForCurrentTrack = false;

  /**
   * Initialize the overlay
   */
  function init() {
    // Start polling for now playing updates
    pollNowPlaying();
    setInterval(pollNowPlaying, 2000); // Poll every 2 seconds
  }

  /**
   * Poll for now playing track
   */
  async function pollNowPlaying() {
    try {
      const response = await fetch(`/api/music/now-playing?token=${token}`);
      if (!response.ok) {
        hideOverlay();
        return;
      }

      const data = await response.json();

      // Hide if not playing or no track
      if (!data.isPlaying || !data.track) {
        hideOverlay();
        hasBeenShownForCurrentTrack = false;
        return;
      }

      // Only show overlay if track is actually playing
      // Update UI if track changed
      if (data.track.id !== currentTrackId) {
        currentTrackId = data.track.id;
        hasBeenShownForCurrentTrack = false;
        updateTrackDisplay(data.track);
        showOverlay(); // Show with new 20s timeout
      } else if (!hasBeenShownForCurrentTrack) {
        // Track is the same but hasn't been shown yet (initial load only)
        updateTrackDisplay(data.track);
        showOverlay();
      }
      // DO NOT re-show after auto-hide timeout - once shown, stay hidden until track changes
    } catch (error) {
      console.error('Error polling now playing:', error);
      hideOverlay();
    }
  }

  /**
   * Update track display
   */
  function updateTrackDisplay(track) {
    // Update text
    elements.trackTitle.textContent = track.title || 'Unknown Track';
    elements.trackArtist.textContent = track.artist || 'Unknown Artist';
    elements.trackAlbum.textContent = track.album || '';

    // Update album art - always show icon for now (file handles don't have covers)
    elements.albumArt.innerHTML = '<i class="bi bi-music-note-beamed"></i>';
  }

  /**
   * Show overlay with animation
   */
  function showOverlay() {
    // Clear any existing timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }

    if (!isVisible) {
      isVisible = true;
      hasBeenShownForCurrentTrack = true;
      elements.nowPlaying.classList.remove('hidden');
      setTimeout(() => {
        elements.nowPlaying.classList.add('visible');
      }, 10);
    }

    // Auto-hide after 20 seconds
    hideTimeout = setTimeout(() => {
      hideOverlay();
    }, 20000);
  }

  /**
   * Hide overlay with animation
   */
  function hideOverlay() {
    if (!isVisible) return;
    isVisible = false;
    
    elements.nowPlaying.classList.remove('visible');
    elements.nowPlaying.classList.add('hidden');
    currentTrackId = null;
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
