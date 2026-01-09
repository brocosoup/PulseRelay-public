/**
 * Music Overlay JavaScript
 * Handles music playback, playlist management, and UI controls
 */

(function() {
  'use strict';

  // Get token from hidden div
  const authData = document.getElementById('authData');
  const token = authData ? authData.dataset.token : '';

  // State
  let playlist = []; // Current playlist
  let currentTrackIndex = -1;
  let isPlaying = false;
  let isShuffle = false;
  let isLoop = false;
  let stopAfterCurrent = false;
  let volumeTransitionInterval = null;
  let audioContext = null;
  let audioElement = null;
  let currentAudioSource = null;

  // DOM elements
  const elements = {
    albumCover: document.getElementById('albumCover'),
    trackTitle: document.getElementById('trackTitle'),
    trackArtist: document.getElementById('trackArtist'),
    progressContainer: document.getElementById('progressContainer'),
    progressBar: document.getElementById('progressBar'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    playPauseBtn: document.getElementById('playPauseBtn'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    shuffleBtn: document.getElementById('shuffleBtn'),
    loopBtn: document.getElementById('loopBtn'),
    volumeSlider: document.getElementById('volumeSlider'),
    browseFilesBtn: document.getElementById('browseFilesBtn'),
    savePlaylistBtn: document.getElementById('savePlaylistBtn'),
    loadPlaylistBtn: document.getElementById('loadPlaylistBtn'),
    clearPlaylistBtn: document.getElementById('clearPlaylistBtn'),
    playlistContainer: document.getElementById('playlist')
  };

  /**
   * Show toast notification
   */
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#6366f1'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Initialize the music player
   */
  async function init() {
    console.log('[Music Player] Initializing...', { token: token ? 'present' : 'missing' });
    try {
      // Create audio element
      audioElement = new Audio();
      audioElement.crossOrigin = 'anonymous';

      // Set up event listeners
      setupEventListeners();

      // Load settings (includes loading saved playlist)
      await loadSettings();

      // Set up periodic updates
      setInterval(updateProgress, 100);
    } catch (error) {
      console.error('Error initializing music player:', error);
    }
  }

  /**
   * Set up event listeners
   */
  function setupEventListeners() {
    // Playback controls
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
    elements.prevBtn.addEventListener('click', playPrevious);
    elements.nextBtn.addEventListener('click', playNext);
    elements.shuffleBtn.addEventListener('click', toggleShuffle);
    elements.loopBtn.addEventListener('click', toggleLoop);
    document.getElementById('stopAfterBtn').addEventListener('click', toggleStopAfter);

    // Volume control
    elements.volumeSlider.addEventListener('input', handleVolumeChange);
    
    // Volume presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetVolume = parseInt(btn.dataset.volume);
        smoothVolumeTransition(targetVolume);
      });
    });
    
    // Speed slider
    const speedSlider = document.getElementById('speedSlider');
    const speedValue = document.getElementById('speedValue');
    speedSlider.addEventListener('input', () => {
      speedValue.textContent = speedSlider.value + 's';
    });

    // Progress bar seek
    elements.progressContainer.addEventListener('click', handleSeek);

    // Settings
    elements.browseFilesBtn.addEventListener('click', browseLocalFiles);
    elements.savePlaylistBtn.addEventListener('click', savePlaylistAs);
    elements.loadPlaylistBtn.addEventListener('click', showLoadPlaylistDialog);
    elements.clearPlaylistBtn.addEventListener('click', clearPlaylist);

    // Audio element events
    audioElement.addEventListener('ended', playNext);
    audioElement.addEventListener('error', handleAudioError);
    audioElement.addEventListener('loadedmetadata', updateTotalTime);

    // Modal close buttons
    document.querySelectorAll('[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        document.getElementById(modalId).classList.remove('active');
      });
    });

    // Clear now-playing when window closes
    window.addEventListener('beforeunload', () => {
      if (token) {
        // Use sendBeacon for reliable delivery on page unload
        const data = JSON.stringify({ isPlaying: false, track: null });
        navigator.sendBeacon(`/api/music/now-playing?token=${token}`, data);
      }
    });
  }

  /**
   * Open IndexedDB
   */
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MusicPlayerDB', 3);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists');
        }
        if (!db.objectStoreNames.contains('fileHandles')) {
          db.createObjectStore('fileHandles');
        }
      };
    });
  }

  /**
   * Load settings
   */
  async function loadSettings() {
    try {
      // Load saved playlist
      await loadPlaylist();
      
      // Restore volume
      const savedVolume = localStorage.getItem('musicPlayerVolume');
      if (savedVolume) {
        elements.volumeSlider.value = savedVolume;
        audioElement.volume = savedVolume / 100;
      } else {
        audioElement.volume = 0.7;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /**
   * Browse and add individual files
   */
  async function browseLocalFiles() {
    try {
      if (!window.showOpenFilePicker) {
        alert('Your browser does not support file browsing. Please use Chrome, Edge, or another Chromium-based browser.');
        return;
      }

      const fileHandles = await window.showOpenFilePicker({
        multiple: true,
        types: [{
          description: 'Audio Files',
          accept: {
            'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus', '.aac', '.wma']
          }
        }]
      });

      for (const fileHandle of fileHandles) {
        const ext = '.' + fileHandle.name.split('.').pop().toLowerCase();
        const file = await fileHandle.getFile();
        
        // Default values
        let artist = 'Unknown Artist';
        let title = fileHandle.name.replace(ext, '');
        let album = 'Unknown Album';
        let hasCover = false;
        
        // Check if jsmediatags is available
        if (!window.jsmediatags) {
          console.error('[Music Player] jsmediatags library not loaded!');
        } else {
          // Try to read ID3 tags
          try {
            const tags = await new Promise((resolve, reject) => {
              window.jsmediatags.read(file, {
                onSuccess: (tag) => resolve(tag),
                onError: (error) => reject(error)
              });
            });
            
            console.log('[Music Player] Tags read for', fileHandle.name, tags);
            
            if (tags && tags.tags) {
              artist = tags.tags.artist || artist;
              title = tags.tags.title || title;
              album = tags.tags.album || album;
              hasCover = !!(tags.tags.picture);
              console.log('[Music Player] Extracted:', { artist, title, album, hasCover });
            }
          } catch (err) {
            console.error('[Music Player] Could not read ID3 tags for', fileHandle.name, err);
          }
        }
        
        const track = {
          id: 'file_' + Date.now() + '_' + Math.random(),
          name: fileHandle.name,
          fileHandle: fileHandle,
          title: title,
          artist: artist,
          album: album,
          hasCover: hasCover,
          path: fileHandle.name
        };
        
        // Add to playlist
        playlist.push(track);
      }

      await savePlaylist();
      renderPlaylist();
      
      // Auto-play first track if none is playing
      if (playlist.length > 0 && currentTrackIndex === -1) {
        await loadTrack(0);
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Error browsing files:', error);
      }
    }
  }

  /**
   * Render playlist UI
   */
  function renderPlaylist() {
    elements.playlistContainer.innerHTML = '';

    if (playlist.length === 0) {
      elements.playlistContainer.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: #6c6c75;">
          <i class="bi bi-music-note-beamed" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: #adadb8;">No music loaded</div>
          <div style="font-size: 13px;">Click "Add Files" to get started</div>
        </div>
      `;
      return;
    }

    playlist.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.draggable = true;
      item.dataset.index = index;
      if (index === currentTrackIndex) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <i class="bi bi-grip-vertical" style="cursor: grab; color: rgba(255,255,255,0.4); flex-shrink: 0;"></i>
          <div style="flex: 1; min-width: 0;">
            <div class="playlist-item-title">${escapeHtml(track.title)}</div>
            <div class="playlist-item-artist">${escapeHtml(track.artist)}</div>
          </div>
        </div>
        <button class="btn-remove" title="Remove">
          <i class="bi bi-trash3"></i>
        </button>
      `;

      // Play on click (on the main div area)
      const mainDiv = item.querySelector('div');
      mainDiv.style.cursor = 'pointer';
      mainDiv.addEventListener('click', async () => {
        await loadTrack(index);
        await play();
      });

      // Remove button
      item.querySelector('.btn-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromPlaylist(index);
      });

      // Drag and drop
      item.addEventListener('dragstart', handleDragStart);
      item.addEventListener('dragover', handleDragOver);
      item.addEventListener('drop', handleDrop);
      item.addEventListener('dragend', handleDragEnd);

      elements.playlistContainer.appendChild(item);
    });
  }

  /**
   * Remove track from playlist
   */
  async function removeFromPlaylist(index) {
    // Adjust current track index if needed
    if (index < currentTrackIndex) {
      currentTrackIndex--;
    } else if (index === currentTrackIndex) {
      pause();
      currentTrackIndex = -1;
    }
    
    playlist.splice(index, 1);
    await savePlaylist();
    renderPlaylist();
  }

  // Drag and drop handlers
  let draggedIndex = null;

  function handleDragStart(e) {
    draggedIndex = parseInt(e.currentTarget.dataset.index);
    e.currentTarget.style.opacity = '0.5';
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e) {
    e.preventDefault();
    const dropIndex = parseInt(e.currentTarget.dataset.index);
    
    if (draggedIndex !== dropIndex) {
      // Reorder playlist
      const draggedTrack = playlist[draggedIndex];
      playlist.splice(draggedIndex, 1);
      playlist.splice(dropIndex, 0, draggedTrack);
      
      // Adjust current track index
      if (currentTrackIndex === draggedIndex) {
        currentTrackIndex = dropIndex;
      } else if (draggedIndex < currentTrackIndex && dropIndex >= currentTrackIndex) {
        currentTrackIndex--;
      } else if (draggedIndex > currentTrackIndex && dropIndex <= currentTrackIndex) {
        currentTrackIndex++;
      }
      
      savePlaylist();
      renderPlaylist();
    }
  }

  function handleDragEnd(e) {
    e.currentTarget.style.opacity = '1';
    draggedIndex = null;
  }

  /**
   * Save playlist to IndexedDB
   */
  async function savePlaylist() {
    try {
      const db = await openDatabase();
      const tx = db.transaction(['playlists', 'fileHandles'], 'readwrite');
      const playlistStore = tx.objectStore('playlists');
      const fileHandleStore = tx.objectStore('fileHandles');
      
      // Store playlist metadata
      const playlistData = playlist.map(track => ({
        id: track.id,
        name: track.name,
        title: track.title,
        artist: track.artist,
        album: track.album,
        path: track.path,
        hasCover: track.hasCover
      }));
      
      playlistStore.put(playlistData, 'currentPlaylist');
      
      // Store file handles separately
      for (const track of playlist) {
        if (track.fileHandle) {
          fileHandleStore.put(track.fileHandle, track.id);
        }
      }
      
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      
      console.log('Playlist saved:', playlist.length, 'tracks');
    } catch (error) {
      console.error('Error saving playlist:', error);
    }
  }

  /**
   * Load playlist from IndexedDB
   */
  async function loadPlaylist() {
    try {
      const db = await openDatabase();
      const tx = db.transaction(['playlists', 'fileHandles'], 'readonly');
      const playlistStore = tx.objectStore('playlists');
      const fileHandleStore = tx.objectStore('fileHandles');
      
      const request = playlistStore.get('currentPlaylist');
      const playlistData = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (playlistData && Array.isArray(playlistData)) {
        // Get all file handles FIRST (before transaction closes)
        const handlePromises = playlistData.map(trackData => {
          return new Promise((resolve, reject) => {
            const handleRequest = fileHandleStore.get(trackData.id);
            handleRequest.onsuccess = () => resolve({ trackData, fileHandle: handleRequest.result });
            handleRequest.onerror = () => resolve({ trackData, fileHandle: null });
          });
        });
        
        const handleResults = await Promise.all(handlePromises);
        
        // Verify permissions (don't request yet - requires user activation)
        const restoredPlaylist = [];
        for (const { trackData, fileHandle } of handleResults) {
          if (fileHandle) {
            try {
              // Only query permission (request will happen when user plays track)
              const permission = await fileHandle.queryPermission({ mode: 'read' });
              if (permission === 'granted' || permission === 'prompt') {
                restoredPlaylist.push({
                  ...trackData,
                  fileHandle: fileHandle
                });
              }
            } catch (error) {
              console.warn('Could not restore file handle for track:', trackData.name, error);
            }
          }
        }
        
        playlist = restoredPlaylist;
        console.log('Playlist loaded:', playlist.length, 'of', playlistData.length, 'tracks restored');
        renderPlaylist();
        
        // Auto-load first track (but don't auto-play)
        if (playlist.length > 0 && currentTrackIndex === -1) {
          await loadTrack(0);
        }
      }
    } catch (error) {
      console.error('Error loading playlist:', error);
    }
  }

  /**
   * Save current playlist with a custom name
   */
  async function savePlaylistAs() {
    console.log('[Save Playlist] Button clicked');
    
    if (playlist.length === 0) {
      showToast('Playlist is empty. Add some tracks first.', 'warning');
      return;
    }

    // Show modal
    const modal = document.getElementById('savePlaylistModal');
    const input = document.getElementById('playlistNameInput');
    const confirmBtn = document.getElementById('confirmSaveBtn');
    
    console.log('[Save Playlist] Modal element:', modal);
    console.log('[Save Playlist] Adding active class');
    
    input.value = '';
    modal.classList.add('active');
    
    // Force modal content to be visible with inline styles
    const modalContent = modal.querySelector('.custom-modal');
    if (modalContent) {
      modalContent.style.minWidth = '400px';
      modalContent.style.background = '#18181b';
      modalContent.style.padding = '24px';
      modalContent.style.borderRadius = '16px';
    }
    
    input.focus();
    
    console.log('[Save Playlist] Modal classes:', modal.className);
    console.log('[Save Playlist] Modal computed display:', window.getComputedStyle(modal).display);
    
    // Handle save confirmation
    const handleSave = async () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }

      try {
        const db = await openDatabase();
        const tx = db.transaction(['playlists', 'fileHandles'], 'readwrite');
        const playlistStore = tx.objectStore('playlists');
        
        // Create saved playlist key
        const playlistKey = 'saved_' + name;
        
        // Store playlist metadata
        const playlistData = playlist.map(track => ({
          id: track.id,
          name: track.name,
          title: track.title,
          artist: track.artist,
          album: track.album,
          path: track.path,
          hasCover: track.hasCover
        }));
        
        playlistStore.put(playlistData, playlistKey);
        
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        
        modal.classList.remove('active');
        showToast(`Playlist "${name}" saved successfully!`, 'success');
        console.log('Playlist saved as:', name);
        
        // Clean up
        confirmBtn.removeEventListener('click', handleSave);
        input.removeEventListener('keypress', handleEnter);
      } catch (error) {
        console.error('Error saving playlist:', error);
        showToast('Failed to save playlist', 'error');
      }
    };
    
    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        handleSave();
      }
    };
    
    // Remove old listeners if any
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newConfirmBtn = document.getElementById('confirmSaveBtn');
    
    newConfirmBtn.addEventListener('click', handleSave);
    input.addEventListener('keypress', handleEnter);
  }

  /**
   * Show dialog to load a saved playlist
   */
  async function showLoadPlaylistDialog() {
    try {
      const db = await openDatabase();
      const tx = db.transaction('playlists', 'readonly');
      const store = tx.objectStore('playlists');
      
      // Get all saved playlist keys
      const keysRequest = store.getAllKeys();
      const keys = await new Promise((resolve, reject) => {
        keysRequest.onsuccess = () => resolve(keysRequest.result);
        keysRequest.onerror = () => reject(keysRequest.error);
      });
      
      // Filter for saved playlists only
      const savedPlaylists = keys.filter(key => key.startsWith('saved_'))
        .map(key => key.replace('saved_', ''));
      
      if (savedPlaylists.length === 0) {
        showToast('No saved playlists found. Save a playlist first.', 'warning');
        return;
      }
      
      // Show modal with playlist list
      const modal = document.getElementById('loadPlaylistModal');
      const listContainer = document.getElementById('playlistList');
      
      // Force modal content to be visible with inline styles
      const modalContent = modal.querySelector('.custom-modal');
      if (modalContent) {
        modalContent.style.minWidth = '400px';
        modalContent.style.background = '#18181b';
        modalContent.style.padding = '24px';
        modalContent.style.borderRadius = '16px';
      }
      
      // Clear and populate list
      listContainer.innerHTML = '';
      savedPlaylists.forEach(name => {
        const item = document.createElement('div');
        item.className = 'playlist-list-item';
        item.innerHTML = `
          <span class="playlist-list-item-name">${escapeHtml(name)}</span>
          <div class="playlist-list-item-icons">
            <i class="bi bi-trash" data-action="delete" title="Delete playlist"></i>
            <i class="bi bi-play-circle" data-action="load" title="Load playlist"></i>
          </div>
        `;
        
        // Handle icon clicks
        item.addEventListener('click', async (e) => {
          const icon = e.target.closest('i');
          if (!icon) return;
          
          const action = icon.dataset.action;
          if (action === 'delete') {
            e.stopPropagation();
            await deletePlaylist(name);
            // Refresh the list
            item.remove();
            if (listContainer.children.length === 0) {
              modal.classList.remove('active');
              showToast('All playlists deleted', 'info');
            }
          } else if (action === 'load') {
            modal.classList.remove('active');
            await loadPlaylistByName(name);
          }
        });
        
        listContainer.appendChild(item);
      });
      
      modal.classList.add('active');
    } catch (error) {
      console.error('Error loading playlist list:', error);
      showToast('Failed to load playlists', 'error');
    }
  }

  /**
   * Load a specific saved playlist by name
   */
  async function loadPlaylistByName(name) {
    try {
      const db = await openDatabase();
      const tx = db.transaction(['playlists', 'fileHandles'], 'readonly');
      const playlistStore = tx.objectStore('playlists');
      const fileHandleStore = tx.objectStore('fileHandles');
      
      const playlistKey = 'saved_' + name;
      const request = playlistStore.get(playlistKey);
      const playlistData = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      if (playlistData && Array.isArray(playlistData)) {
        // Get all file handles FIRST (before transaction closes)
        const handlePromises = playlistData.map(trackData => {
          return new Promise((resolve, reject) => {
            const handleRequest = fileHandleStore.get(trackData.id);
            handleRequest.onsuccess = () => resolve({ trackData, fileHandle: handleRequest.result });
            handleRequest.onerror = () => resolve({ trackData, fileHandle: null });
          });
        });
        
        const handleResults = await Promise.all(handlePromises);
        
        // Stop current playback
        pause();
        
        // Verify permissions (request will happen when user plays track)
        const restoredPlaylist = [];
        for (const { trackData, fileHandle } of handleResults) {
          if (fileHandle) {
            try {
              // Query permission first (request happens when track is loaded)
              const permission = await fileHandle.queryPermission({ mode: 'read' });
              if (permission === 'granted' || permission === 'prompt') {
                restoredPlaylist.push({
                  ...trackData,
                  fileHandle: fileHandle
                });
              }
            } catch (error) {
              console.warn('Could not restore file handle for track:', trackData.name, error);
            }
          }
        }
        
        // Replace current playlist
        playlist = restoredPlaylist;
        currentTrackIndex = -1;
        
        console.log('Playlist loaded:', playlist.length, 'of', playlistData.length, 'tracks restored');
        renderPlaylist();
        
        // Auto-load first track
        if (playlist.length > 0) {
          await loadTrack(0);
        }
        
        // Save as current playlist
        await savePlaylist();
        
        showToast(`Playlist "${name}" loaded with ${playlist.length} tracks`, 'success');
      }
    } catch (error) {
      console.error('Error loading playlist:', error);
      showToast('Failed to load playlist', 'error');
    }
  }

  /**
   * Delete a saved playlist by name
   */
  async function deletePlaylist(name) {
    try {
      const db = await openDatabase();
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      
      // Delete the saved playlist
      const deleteRequest = store.delete(`saved_${name}`);
      
      await new Promise((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
      
      showToast(`Playlist "${name}" deleted`, 'success');
    } catch (error) {
      console.error('Error deleting playlist:', error);
      showToast('Failed to delete playlist', 'error');
    }
  }

  /**
   * Clear the current playlist
   */
  async function clearPlaylist() {
    if (playlist.length === 0) {
      showToast('Playlist is already empty', 'info');
      return;
    }

    // Stop playback
    pause();
    
    // Clear playlist
    playlist = [];
    currentTrackIndex = -1;
    
    // Reset UI
    elements.trackTitle.textContent = 'No Track Loaded';
    elements.trackArtist.textContent = 'Select a track to play';
    elements.albumCover.innerHTML = '<i class="bi bi-music-note-beamed"></i>';
    
    // Clear audio
    audioElement.src = '';
    
    // Update display
    renderPlaylist();
    
    // Clear saved playlist
    await savePlaylist();
    
    // Update now playing
    updateNowPlaying();
    
    showToast('Playlist cleared', 'success');
  }

  /**
   * Browse and add individual files
   */
  /**
   * Load a track by index
   */
  async function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return;

    const track = playlist[index];
    currentTrackIndex = index;

    // Update UI
    elements.trackTitle.textContent = track.title;
    elements.trackArtist.textContent = track.artist;

    // Update album cover (use default icon for now)
    elements.albumCover.innerHTML = '<i class="bi bi-music-note-beamed"></i>';

    // Load audio from local file
    try {
      // Request permission if needed (user action present)
      const permission = await track.fileHandle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        console.error('Permission denied to access file:', track.name);
        return;
      }
      
      const file = await track.fileHandle.getFile();
      const url = URL.createObjectURL(file);
      
      // Revoke previous object URL if exists
      if (audioElement.src && audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioElement.src);
      }
      
      audioElement.src = url;
      audioElement.load(); // Explicitly trigger load
    } catch (error) {
      console.error('Error loading audio file:', error);
    }

    // Update playlist active state
    renderPlaylist();

    // Update now playing state
    updateNowPlaying();
  }

  /**
   * Update now playing state on server
   */
  async function updateNowPlaying() {
    if (currentTrackIndex === -1 || !playlist[currentTrackIndex]) {
      // No track loaded
      try {
        await fetch(`/api/music/now-playing?token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isPlaying: false,
            track: null
          })
        });
      } catch (error) {
        console.error('Error updating now playing:', error);
      }
      return;
    }

    const track = playlist[currentTrackIndex];
    try {
      await fetch(`/api/music/now-playing?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isPlaying: isPlaying,
          track: {
            id: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            hasCover: track.hasCover
          }
        })
      });
    } catch (error) {
      console.error('Error updating now playing:', error);
    }
  }

  /**
   * Toggle play/pause
   */
  async function togglePlayPause() {
    if (currentTrackIndex === -1 && playlist.length > 0) {
      loadTrack(0);
    }

    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }

  /**
   * Play current track
   */
  async function play() {
    try {
      // Wait for audio to be ready if needed
      if (audioElement.readyState < 2) {
        await new Promise((resolve) => {
          audioElement.addEventListener('canplay', resolve, { once: true });
        });
      }
      
      await audioElement.play();
      isPlaying = true;
      updatePlayPauseButton();
      updateNowPlaying();
    } catch (error) {
      console.error('Error playing audio:', error);
      isPlaying = false;
      updatePlayPauseButton();
      updateNowPlaying();
    }
  }

  /**
   * Pause current track
   */
  function pause() {
    audioElement.pause();
    isPlaying = false;
    updatePlayPauseButton();
    updateNowPlaying();
  }

  /**
   * Play previous track
   */
  async function playPrevious() {
    if (playlist.length === 0) return;

    let newIndex = currentTrackIndex - 1;
    if (newIndex < 0) {
      newIndex = playlist.length - 1;
    }

    await loadTrack(newIndex);
    if (isPlaying) {
      await play();
    }
  }

  /**
   * Play next track
   */
  async function playNext() {
    if (playlist.length === 0) return;

    let newIndex;
    if (isShuffle) {
      newIndex = Math.floor(Math.random() * playlist.length);
    } else {
      newIndex = currentTrackIndex + 1;
      if (newIndex >= playlist.length) {
        if (isLoop) {
          newIndex = 0; // Loop back to start
        } else {
          return; // Stop at end
        }
      }
    }

    await loadTrack(newIndex);
    if (isPlaying) {
      await play();
    }
  }

  /**
   * Toggle shuffle mode
   */
  function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle) {
      elements.shuffleBtn.classList.add('active');
    } else {
      elements.shuffleBtn.classList.remove('active');
    }
  }

  /**
   * Toggle loop mode
   */
  function toggleLoop() {
    isLoop = !isLoop;
    if (isLoop) {
      elements.loopBtn.classList.add('active');
    } else {
      elements.loopBtn.classList.remove('active');
    }
  }

  /**
   * Update play/pause button
   */
  function updatePlayPauseButton() {
    const icon = elements.playPauseBtn.querySelector('i');
    if (isPlaying) {
      icon.className = 'bi bi-pause-fill';
      elements.playPauseBtn.title = 'Pause';
    } else {
      icon.className = 'bi bi-play-fill';
      elements.playPauseBtn.title = 'Play';
    }
  }

  /**
   * Handle volume change
   */
  function handleVolumeChange(e) {
    const volume = e.target.value / 100;
    audioElement.volume = volume;
    localStorage.setItem('musicPlayerVolume', e.target.value);
  }

  /**
   * Handle progress bar seek
   */
  function handleSeek(e) {
    if (!audioElement.duration) return;

    const rect = elements.progressContainer.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioElement.currentTime = percent * audioElement.duration;
  }

  /**
   * Update progress bar and time display
   */
  function updateProgress() {
    if (!audioElement.duration) return;

    const percent = (audioElement.currentTime / audioElement.duration) * 100;
    elements.progressBar.style.width = `${percent}%`;
    elements.currentTime.textContent = formatTime(audioElement.currentTime);
  }

  /**
   * Update total time display
   */
  function updateTotalTime() {
    elements.totalTime.textContent = formatTime(audioElement.duration || 0);
  }

  /**
   * Format time in MM:SS
   */
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Handle audio error
   */
  function handleAudioError(e) {
    console.error('Audio error:', e);
    isPlaying = false;
    updatePlayPauseButton();
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toggle stop after current track
   */
  function toggleStopAfter() {
    stopAfterCurrent = !stopAfterCurrent;
    const btn = document.getElementById('stopAfterBtn');
    btn.classList.toggle('active', stopAfterCurrent);
    showToast(stopAfterCurrent ? 'Will stop after current track' : 'Stop after current disabled', 'info');
  }

  /**
   * Smooth volume transition
   */
  function smoothVolumeTransition(targetVolume) {
    if (volumeTransitionInterval) {
      clearInterval(volumeTransitionInterval);
    }

    const speedSlider = document.getElementById('speedSlider');
    const duration = parseFloat(speedSlider.value) * 1000; // Convert to ms
    const startVolume = audioElement.volume * 100;
    const diff = targetVolume - startVolume;
    const steps = 50;
    const stepDuration = duration / steps;
    const stepSize = diff / steps;
    
    let currentStep = 0;
    
    volumeTransitionInterval = setInterval(() => {
      currentStep++;
      const newVolume = startVolume + (stepSize * currentStep);
      
      if (currentStep >= steps) {
        audioElement.volume = targetVolume / 100;
        elements.volumeSlider.value = targetVolume;
        localStorage.setItem('musicPlayerVolume', targetVolume);
        clearInterval(volumeTransitionInterval);
        volumeTransitionInterval = null;
      } else {
        audioElement.volume = newVolume / 100;
        elements.volumeSlider.value = Math.round(newVolume);
      }
    }, stepDuration);
  }

  // Modify playNext to respect stopAfterCurrent
  const originalPlayNext = playNext;
  playNext = function() {
    if (stopAfterCurrent) {
      audioElement.pause();
      isPlaying = false;
      elements.playPauseBtn.querySelector('i').className = 'bi bi-play-fill';
      stopAfterCurrent = false;
      document.getElementById('stopAfterBtn').classList.remove('active');
      showToast('Stopped after track', 'info');
      return;
    }
    originalPlayNext();
  };

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
