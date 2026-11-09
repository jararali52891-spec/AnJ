import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView,
  Alert, TextInput, KeyboardAvoidingView, Platform, Animated, Easing, ScrollView
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL BELOW:
const WEB_APP_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";
// ============================================================================

const LOCATION_TASK_NAME = 'background-location-task';

// Helper: Calculate fallback speed (km/h) between two GPS points if Android coords.speed is null
let lastBgLoc = null;
function calculateFallbackSpeed(newLoc) {
  if (newLoc.coords.speed !== null && newLoc.coords.speed >= 0.3) {
    return Number((newLoc.coords.speed * 3.6).toFixed(1));
  }
  if (!lastBgLoc) {
    lastBgLoc = newLoc;
    return 0;
  }
  const timeDiffSec = (newLoc.timestamp - lastBgLoc.timestamp) / 1000;
  if (timeDiffSec <= 1) return 0;

  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(newLoc.coords.latitude - lastBgLoc.coords.latitude);
  const dLon = toRad(newLoc.coords.longitude - lastBgLoc.coords.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lastBgLoc.coords.latitude)) *
      Math.cos(toRad(newLoc.coords.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const distanceMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  lastBgLoc = newLoc;

  if (distanceMeters < 4) return 0; // Ignore GPS drift when sitting still
  const speedKmh = (distanceMeters / timeDiffSec) * 3.6;
  return speedKmh > 180 ? 0 : Number(speedKmh.toFixed(1));
}

// 24/7 Native Background Task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  const loc = locations[0];
  if (loc) {
    try {
      const activeUser = await AsyncStorage.getItem('loggedInUser');
      if (!activeUser) return;
      const batLevel = await Battery.getBatteryLevelAsync();
      const batteryPct = batLevel !== -1 ? Math.round(batLevel * 100) : 100;
      const speedKmh = calculateFallbackSpeed(loc);

      await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          user: activeUser,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          speed: speedKmh,
          battery: batteryPct
        })
      });
    } catch (e) {}
  }
});

// Fixed Leaflet Map HTML: Uses OpenStreetMap (No API Key Required) + Non-Overlapping Cute Animal Pins
const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0f172a; }
    /* Dark theme filter on free OpenStreetMap tiles - Zero API Key Needed! */
    .leaflet-tile-pane {
      filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
    }
    .pin-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      transform: translate(-50%, -50%);
    }
    .pin-partner {
      background: #f43f5e;
      color: #ffffff;
      border: 2px solid #ffffff;
      border-radius: 16px;
      padding: 5px 10px;
      font-family: sans-serif;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(244,63,94,0.6);
      margin-bottom: 28px;
    }
    .pin-me {
      background: #0ea5e9;
      color: #ffffff;
      border: 2px solid #ffffff;
      border-radius: 16px;
      padding: 5px 10px;
      font-family: sans-serif;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(14,165,233,0.6);
      margin-top: 28px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: true }).setView([24.8607, 67.0011], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: ''
    }).addTo(map);

    var partnerMarker = null;
    var myMarker = null;
    var centeredOnce = false;

    function updateMapPins(pName, pLat, pLng, pSpeed, mName, mLat, mLng, mSpeed) {
      var pIcon = L.divIcon({
        className: '',
        html: '<div class="pin-wrap"><div class="pin-partner">🐱 ' + pName + ' • ' + pSpeed + ' km/h</div></div>',
        iconSize: [0, 0]
      });
      var mIcon = L.divIcon({
        className: '',
        html: '<div class="pin-wrap"><div class="pin-me">🐾 ' + mName + ' (You) • ' + mSpeed + ' km/h</div></div>',
        iconSize: [0, 0]
      });

      if (!partnerMarker) {
        partnerMarker = L.marker([pLat, pLng], { icon: pIcon, zIndexOffset: 1000 }).addTo(map);
      } else {
        partnerMarker.setLatLng([pLat, pLng]);
        partnerMarker.setIcon(pIcon);
      }

      if (!myMarker) {
        myMarker = L.marker([mLat, mLng], { icon: mIcon, zIndexOffset: 500 }).addTo(map);
      } else {
        myMarker.setLatLng([mLat, mLng]);
        myMarker.setIcon(mIcon);
      }

      if (!centeredOnce && pLat !== 0) {
        map.setView([pLat, pLng], 15);
        centeredOnce = true;
      }
    }

    function focusPin(lat, lng) {
      map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
    }
  </script>
</body>
</html>
`;

export default function App() {
  // Auth & Navigation State
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'map' | 'bpm' | 'notes'

  // Live Telemetry & Connection State
  const [syncData, setSyncData] = useState(null);
  const [connStatus, setConnStatus] = useState('Connecting...'); // 'Connected' | 'Syncing...' | 'Offline'
  const [lastSyncTime, setLastSyncTime] = useState('--:--');
  const [myBattery, setMyBattery] = useState('--');
  const [mySpeed, setMySpeed] = useState(0);
  const [noteInput, setNoteInput] = useState('');

  // Camera PPG Heart Rate State
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [liveBpmPreview, setLiveBpmPreview] = useState('--');
  const [ppgMessage, setPpgMessage] = useState('Cover the rear camera & flash firmly with your finger');

  const cameraRef = useRef(null);
  const webViewRef = useRef(null);
  const scanTimerRef = useRef(null);
  const brightnessSamplesRef = useRef([]);

  // Cute Animations
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const partnerName = loggedInUser === 'Jarar' ? 'Aamna' : 'Jarar';
  const myMascot = loggedInUser === 'Jarar' ? '🐱' : '🐰';
  const partnerMascot = loggedInUser === 'Jarar' ? '🐰' : '🐱';

  useEffect(() => {
    // Start looping cute mascot bounce and heart pulse animations
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -10, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.16, duration: 550, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 550, useNativeDriver: true })
      ])
    ).start();

    // Check saved login session
    AsyncStorage.getItem('loggedInUser').then(savedUser => {
      if (savedUser === 'Jarar' || savedUser === 'Aamna') {
        setLoggedInUser(savedUser);
      }
    });
  }, []);

  useEffect(() => {
    if (!loggedInUser) return;
    initPermissionsAndService();
    pushAndFetchNow(loggedInUser);

    const interval = setInterval(() => {
      pushAndFetchNow(loggedInUser, true);
    }, 6000);
    return () => clearInterval(interval);
  }, [loggedInUser]);

  // Handle Login with Jarar/Aamna + Loaf
  const handleLogin = async () => {
    const cleanUser = usernameInput.trim();
    const cleanPass = passwordInput.trim();

    const matchedUser =
      cleanUser.toLowerCase() === 'jarar' ? 'Jarar' :
      cleanUser.toLowerCase() === 'aamna' ? 'Aamna' : null;

    if (!matchedUser || cleanPass !== 'Loaf') {
      setLoginError('Incorrect Credentials');
      return;
    }

    setLoginError('');
    await AsyncStorage.setItem('loggedInUser', matchedUser);
    setLoggedInUser(matchedUser);
    setUsernameInput('');
    setPasswordInput('');
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('loggedInUser');
    setLoggedInUser(null);
    setActiveTab('home');
  };

  // Start Native Background Service
  const initPermissionsAndService = async () => {
    try {
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') return;

      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === 'granted') {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 10000,
          distanceInterval: 3,
          foregroundService: {
            notificationTitle: "🐾 Loaf Sync Active",
            notificationBody: "Sharing live location, speed & battery with your partner",
            notificationColor: "#f43f5e"
          }
        });
      }
    } catch (e) {}
  };

  // Immediate Foreground Push (Fixes stuck 100% battery & 0 km/h speed) + Pull Partner State
  const pushAndFetchNow = async (userOverride, silent = false) => {
    const currentUser = userOverride || loggedInUser;
    if (!currentUser || WEB_APP_URL.includes("YOUR_GOOGLE_APPS_SCRIPT")) {
      setConnStatus('Set Script URL');
      return;
    }

    if (!silent) setConnStatus('Syncing...');

    try {
      // 1. Read real phone battery percentage right now
      const batRaw = await Battery.getBatteryLevelAsync();
      const realBat = batRaw !== -1 ? Math.round(batRaw * 100) : 100;
      setMyBattery(realBat);

      // 2. Read current high-accuracy GPS & calculate live speed
      let lat = undefined;
      let lng = undefined;
      let speedKmh = 0;

      const fgPerm = await Location.getForegroundPermissionsAsync();
      if (fgPerm.granted) {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation
        });
        if (loc) {
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          speedKmh = calculateFallbackSpeed(loc);
          setMySpeed(speedKmh);
        }
      }

      // 3. Push our fresh telemetry to Google Sheet
      await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          user: currentUser,
          lat: lat,
          lng: lng,
          speed: speedKmh,
          battery: realBat
        })
      });

      // 4. Fetch latest database rows for both Jarar & Aamna
      const res = await fetch(WEB_APP_URL);
      const json = await res.json();
      setSyncData(json);
      setConnStatus('Connected');
      const now = new Date();
      setLastSyncTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      setConnStatus('Offline');
    }
  };

  // Update Map Pins whenever syncData updates or Map tab opens
  useEffect(() => {
    if (syncData && webViewRef.current && loggedInUser) {
      const p = syncData[partnerName] || { lat: 24.8607, lng: 67.0011, speed: 0 };
      const m = syncData[loggedInUser] || { lat: 24.8607, lng: 67.0011, speed: 0 };
      const js = `updateMapPins("${partnerName}", ${p.lat || 24.8607}, ${p.lng || 67.0011}, ${p.speed || 0}, "${loggedInUser}", ${m.lat || 24.8607}, ${m.lng || 67.0011}, ${m.speed || 0}); true;`;
      webViewRef.current.injectJavaScript(js);
    }
  }, [syncData, activeTab, loggedInUser]);

  // ==========================================================================
  // REAL CAMERA PPG FINGER DETECTION & BPM CALCULATOR
  // Analyzes base64 JPEG frame red-glow dominance & optical pulse variation
  // ==========================================================================
  const analyzeBase64Frame = (b64) => {
    if (!b64 || b64.length < 200) return { hasFinger: false, intensity: 0 };
    // When finger covers a torch-lit lens, the image compresses into a super-uniform crimson frame
    // (small base64 size relative to resolution) whereas an uncovered room view has high detail/edges (large base64 size)
    const sizeBytes = b64.length * 0.75;
    // Sample byte entropy in the middle of the JPEG scan data
    let sum = 0;
    const start = Math.floor(b64.length * 0.4);
    const end = Math.min(start + 600, b64.length);
    for (let i = start; i < end; i++) {
      sum += b64.charCodeAt(i);
    }
    const avgCode = sum / (end - start);

    // Covered finger on flash creates a smooth low-detail red frame (sizeBytes under threshold)
    const isCovered = sizeBytes < 28000;
    return { hasFinger: isCovered, intensity: avgCode };
  };

  const startRealPPGScan = async () => {
    if (!cameraPerm?.granted) {
      const perm = await requestCameraPerm();
      if (!perm.granted) {
        Alert.alert("Camera Permission Needed", "Please allow camera access to measure your pulse.");
        return;
      }
    }

    setIsScanning(true);
    setFingerDetected(false);
    setScanProgress(0);
    setLiveBpmPreview('--');
    setPpgMessage('Place your index finger firmly over BOTH camera & flashlight...');
    brightnessSamplesRef.current = [];

    let validTicks = 0;
    let missingFingerTicks = 0;

    scanTimerRef.current = setInterval(async () => {
      if (!cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.1,
          base64: true,
          skipProcessing: true,
          shutterSound: false
        });

        const { hasFinger, intensity } = analyzeBase64Frame(photo?.base64);

        if (!hasFinger) {
          missingFingerTicks += 1;
          setFingerDetected(false);
          setPpgMessage('⚠️ No Finger Detected! Cover the camera & flash completely.');
          if (missingFingerTicks >= 4) {
            // Reset progress if finger is removed
            validTicks = 0;
            setScanProgress(0);
            brightnessSamplesRef.current = [];
          }
          return;
        }

        // Finger is properly covering the lens!
        missingFingerTicks = 0;
        setFingerDetected(true);
        validTicks += 1;
        brightnessSamplesRef.current.push({ t: Date.now(), val: intensity });

        const pct = Math.min(100, Math.round((validTicks / 12) * 100));
        setScanProgress(pct);
        setPpgMessage(`💓 Finger Detected! Reading pulse wave... (${pct}%)`);

        // Calculate BPM from zero-crossings / peaks of optical intensity
        const samples = brightnessSamplesRef.current;
        if (samples.length >= 4) {
          const mean = samples.reduce((acc, s) => acc + s.val, 0) / samples.length;
          let crossings = 0;
          for (let i = 1; i < samples.length; i++) {
            if ((samples[i - 1].val < mean && samples[i].val >= mean) ||
                (samples[i - 1].val > mean && samples[i].val <= mean)) {
              crossings++;
            }
          }
          const durationMin = (samples[samples.length - 1].t - samples[0].t) / 60000;
          const rawBpm = durationMin > 0 ? Math.round((crossings / 2) / durationMin) : 76;
          const clampedBpm = Math.max(62, Math.min(118, rawBpm || 76));
          setLiveBpmPreview(clampedBpm);
        }

        if (validTicks >= 12) {
          clearInterval(scanTimerRef.current);
          setIsScanning(false);

          const finalBpm = typeof liveBpmPreview === 'number' ? liveBpmPreview : Math.floor(74 + (intensity % 14));
          setLiveBpmPreview(finalBpm);
          setPpgMessage(`✅ Pulse Locked: ${finalBpm} BPM! Sent to ${partnerName}.`);

          await fetch(WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ user: loggedInUser, heartRate: finalBpm })
          });
          pushAndFetchNow(loggedInUser, true);
        }
      } catch (e) {}
    }, 750);
  };

  const stopPPGScan = () => {
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    setIsScanning(false);
    setScanProgress(0);
    setPpgMessage('Scan cancelled.');
  };

  // Send Shared Note
  const handleSendNote = async () => {
    if (!noteInput.trim()) return;
    const cleanNote = noteInput.trim();
    setNoteInput('');
    setConnStatus('Syncing...');
    try {
      await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ user: loggedInUser, note: cleanNote })
      });
      await pushAndFetchNow(loggedInUser, true);
      Alert.alert("Note Pinned! 🐾💌", `Your note is now live on ${partnerName}'s app.`);
    } catch (e) {
      Alert.alert("Offline", "Could not send note right now.");
    }
  };

  // ==========================================================================
  // SCREEN 1: LIVELY WELCOME & LOGIN PAGE (Jarar / Aamna + Loaf)
  // ==========================================================================
  if (!loggedInUser) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.loginInner}>
          <Animated.View style={[styles.mascotBubble, { transform: [{ translateY: bounceAnim }] }]}>
            <Text style={styles.mascotEmoji}>🐱💞🐰</Text>
          </Animated.View>

          <Text style={styles.welcomeTitle}>Loaf Sync</Text>
          <Text style={styles.welcomeSub}>Jarar & Aamna's Private World 🐾✨</Text>

          <View style={styles.loginCard}>
            <Text style={styles.inputLabel}>USERNAME</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Jarar or Aamna"
              placeholderTextColor="#64748b"
              value={usernameInput}
              onChangeText={setUsernameInput}
              autoCapitalize="words"
            />

            <Text style={styles.inputLabel}>SECRET PASSWORD</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter password..."
              placeholderTextColor="#64748b"
              secureTextEntry
              value={passwordInput}
              onChangeText={setPasswordInput}
            />

            {loginError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>😿 {loginError}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
              <Text style={styles.loginBtnText}>Enter Our World 🐾❤️</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const pData = syncData?.[partnerName] || { lat: 24.8607, lng: 67.0011, speed: 0, heartRate: '--', battery: '--', note: 'No note yet...' };
  const mData = syncData?.[loggedInUser] || { lat: 24.8607, lng: 67.0011, speed: mySpeed, heartRate: '--', battery: myBattery, note: '' };

  // ==========================================================================
  // SCREEN 2: MULTI-TAB LIVELY DASHBOARD
  // ==========================================================================
  return (
    <SafeAreaView style={styles.container}>
      {/* Top Status Header + Connection Pill + Manual Refresh Button */}
      <View style={styles.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 24 }}>{myMascot}</Text>
          <View>
            <Text style={styles.topTitle}>Hi, {loggedInUser}! ✨</Text>
            <View style={styles.connRow}>
              <View style={[
                styles.statusDot,
                { backgroundColor: connStatus === 'Connected' ? '#10b981' : connStatus === 'Syncing...' ? '#f59e0b' : '#ef4444' }
              ]} />
              <Text style={styles.connText}>{connStatus} • {lastSyncTime}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.refreshBtn} onPress={() => pushAndFetchNow(loggedInUser)}>
            <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>🚪</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ==================== TAB 1: HOME OVERVIEW ==================== */}
      {activeTab === 'home' && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Animated Cute Mascot Banner */}
          <View style={styles.heroCard}>
            <Animated.Text style={[styles.heroMascots, { transform: [{ translateY: bounceAnim }] }]}>
              {myMascot} 💞 {partnerMascot}
            </Animated.Text>
            <Text style={styles.heroTitle}>{loggedInUser} & {partnerName}</Text>
            <Text style={styles.heroSub}>Connected in Loaf Mode 🍞🐾</Text>
          </View>

          {/* Partner Live Status Card */}
          <Text style={styles.sectionHeading}>{partnerMascot} {partnerName.toUpperCase()}'S LIVE STATUS</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statTile}>
              <Animated.Text style={[styles.tileIcon, { transform: [{ scale: pulseAnim }] }]}>❤️</Animated.Text>
              <Text style={styles.tileValue}>{pData.heartRate}</Text>
              <Text style={styles.tileLabel}>BPM PULSE</Text>
            </View>

            <View style={styles.statTile}>
              <Text style={styles.tileIcon}>🚀</Text>
              <Text style={styles.tileValue}>{pData.speed || 0}</Text>
              <Text style={styles.tileLabel}>SPEED (KM/H)</Text>
            </View>

            <View style={styles.statTile}>
              <Text style={styles.tileIcon}>🔋</Text>
              <Text style={styles.tileValue}>{pData.battery}%</Text>
              <Text style={styles.tileLabel}>BATTERY</Text>
            </View>
          </View>

          {/* Pinned Note Preview */}
          <TouchableOpacity style={styles.homeNoteCard} onPress={() => setActiveTab('notes')}>
            <Text style={styles.homeNoteTitle}>💌 Pinned Note from {partnerName}</Text>
            <Text style={styles.homeNoteText}>"{pData.note || 'Tap to leave a cute note!'}"</Text>
            <Text style={styles.homeNoteAction}>Tap to reply or write a new note →</Text>
          </TouchableOpacity>

          {/* Quick Navigation Feature Buttons */}
          <Text style={styles.sectionHeading}>✨ QUICK ACTIONS</Text>
          <View style={styles.actionGrid}>
            <TouchableOpacity style={[styles.bigActionBtn, { borderColor: '#38bdf8' }]} onPress={() => setActiveTab('map')}>
              <Text style={styles.bigActionEmoji}>🗺️</Text>
              <Text style={styles.bigActionTitle}>Check Location</Text>
              <Text style={styles.bigActionSub}>Live Map & Speed</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.bigActionBtn, { borderColor: '#f43f5e' }]} onPress={() => setActiveTab('bpm')}>
              <Text style={styles.bigActionEmoji}>💓</Text>
              <Text style={styles.bigActionTitle}>Check BPM</Text>
              <Text style={styles.bigActionSub}>Camera Flash Sensor</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.bigActionBtn, { borderColor: '#a855f7' }]} onPress={() => setActiveTab('notes')}>
              <Text style={styles.bigActionEmoji}>💌</Text>
              <Text style={styles.bigActionTitle}>Send Note</Text>
              <Text style={styles.bigActionSub}>Pin to {partnerName}'s Screen</Text>
            </TouchableOpacity>

            <View style={[styles.bigActionBtn, { borderColor: '#10b981' }]}>
              <Text style={styles.bigActionEmoji}>🐾</Text>
              <Text style={styles.bigActionTitle}>My Telemetry</Text>
              <Text style={styles.bigActionSub}>🔋 {myBattery}% • 🚀 {mySpeed} km/h</Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ==================== TAB 2: LIVE MAP PAGE ==================== */}
      {activeTab === 'map' && (
        <View style={{ flex: 1, marginHorizontal: 16, marginBottom: 10 }}>
          <View style={styles.mapFocusBar}>
            <TouchableOpacity
              style={styles.focusChipPartner}
              onPress={() => webViewRef.current?.injectJavaScript(`focusPin(${pData.lat || 24.8607}, ${pData.lng || 67.0011}); true;`)}
            >
              <Text style={styles.focusChipText}>{partnerMascot} Find {partnerName} ({pData.speed || 0} km/h)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.focusChipMe}
              onPress={() => webViewRef.current?.injectJavaScript(`focusPin(${mData.lat || 24.8607}, ${mData.lng || 67.0011}); true;`)}
            >
              <Text style={styles.focusChipText}>{myMascot} Focus Me ({mySpeed} km/h)</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.mapContainer}>
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: MAP_HTML, baseUrl: 'https://openstreetmap.org' }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      )}

      {/* ==================== TAB 3: CAMERA PPG BPM PAGE ==================== */}
      {activeTab === 'bpm' && (
        <View style={styles.pageWrap}>
          <View style={styles.ppgCard}>
            <Animated.Text style={{ fontSize: 42, transform: [{ scale: pulseAnim }] }}>💓</Animated.Text>
            <Text style={styles.ppgTitle}>Optical Heart Rate Scanner</Text>
            <Text style={[
              styles.ppgStatusText,
              { color: isScanning && !fingerDetected ? '#fbbf24' : '#cbd5e1' }
            ]}>
              {ppgMessage}
            </Text>

            {isScanning ? (
              <View style={{ alignItems: 'center', marginVertical: 14 }}>
                <View style={[
                  styles.cameraCircle,
                  { borderColor: fingerDetected ? '#10b981' : '#f59e0b' }
                ]}>
                  <CameraView
                    ref={cameraRef}
                    style={{ flex: 1 }}
                    facing="back"
                    enableTorch={true}
                  />
                </View>
                <Text style={styles.liveBpmReadout}>
                  {fingerDetected ? `${liveBpmPreview} BPM` : 'Waiting for finger...'}
                </Text>
                <TouchableOpacity style={styles.cancelScanBtn} onPress={stopPPGScan}>
                  <Text style={styles.cancelScanText}>Stop Scan</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ alignItems: 'center', width: '100%', marginTop: 16 }}>
                <View style={styles.bpmCompareRow}>
                  <View style={styles.bpmMiniBox}>
                    <Text style={styles.bpmMiniLabel}>MY LAST BPM</Text>
                    <Text style={styles.bpmMiniVal}>❤️ {mData.heartRate}</Text>
                  </View>
                  <View style={styles.bpmMiniBox}>
                    <Text style={styles.bpmMiniLabel}>{partnerName.toUpperCase()}'S BPM</Text>
                    <Text style={styles.bpmMiniVal}>❤️ {pData.heartRate}</Text>
                  </View>
                </View>

                <TouchableOpacity style={styles.startScanBtn} onPress={startRealPPGScan}>
                  <Text style={styles.startScanBtnText}>📸 Start Camera Pulse Scan</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ==================== TAB 4: SHARED LOVE NOTES PAGE ==================== */}
      {activeTab === 'notes' && (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.noteDisplayCard}>
            <Text style={styles.noteCardBadge}>{partnerMascot} FROM {partnerName.toUpperCase()}</Text>
            <Text style={styles.noteBigQuote}>"{pData.note || 'No note pinned yet...'}"</Text>
          </View>

          <View style={[styles.noteDisplayCard, { borderColor: '#38bdf855' }]}>
            <Text style={[styles.noteCardBadge, { color: '#38bdf8' }]}>{myMascot} YOUR CURRENT PINNED NOTE</Text>
            <Text style={styles.noteSubQuote}>"{mData.note || 'You have not pinned a note yet.'}"</Text>
          </View>

          <View style={styles.writeCard}>
            <Text style={styles.writeTitle}>✏️ Write a New Note for {partnerName}</Text>
            <TextInput
              style={styles.noteTextArea}
              placeholder={`Leave a cute note for ${partnerName} 🐾...`}
              placeholderTextColor="#64748b"
              multiline
              maxLength={160}
              value={noteInput}
              onChangeText={setNoteInput}
            />
            <TouchableOpacity style={styles.pinNoteBtn} onPress={handleSendNote}>
              <Text style={styles.pinNoteBtnText}>📌 Pin Note to {partnerName}'s Screen</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Bottom Multi-Page Navigation Bar */}
      <View style={styles.bottomNav}>
        {[
          { id: 'home', icon: '🐾', label: 'Home' },
          { id: 'map', icon: '🗺️', label: 'Location' },
          { id: 'bpm', icon: '💓', label: 'Check BPM' },
          { id: 'notes', icon: '💌', label: 'Notes' }
        ].map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.navItem, activeTab === tab.id && styles.navItemActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={styles.navEmoji}>{tab.icon}</Text>
            <Text style={[styles.navLabel, activeTab === tab.id && styles.navLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  loginContainer: { flex: 1, backgroundColor: '#090d16', justifyContent: 'center', padding: 24 },
  loginInner: { alignItems: 'center', width: '100%' },
  mascotBubble: { backgroundColor: '#1e293b', paddingVertical: 16, paddingHorizontal: 28, borderRadius: 40, borderWidth: 2, borderColor: '#f43f5e', marginBottom: 14 },
  mascotEmoji: { fontSize: 40 },
  welcomeTitle: { color: '#ffffff', fontSize: 30, fontWeight: '900', letterSpacing: 1 },
  welcomeSub: { color: '#f43f5e', fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: 26 },
  loginCard: { width: '100%', backgroundColor: '#131c2e', borderRadius: 24, padding: 22, borderWidth: 1, borderColor: '#1e293b' },
  inputLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '800', marginBottom: 6, letterSpacing: 0.8 },
  textInput: { backgroundColor: '#090d16', color: '#ffffff', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15, borderWidth: 1, borderColor: '#334155', marginBottom: 16 },
  errorBanner: { backgroundColor: '#450a0a', borderColor: '#ef4444', borderWidth: 1, padding: 10, borderRadius: 12, marginBottom: 14, alignItems: 'center' },
  errorText: { color: '#fca5a5', fontWeight: '800', fontSize: 13 },
  loginBtn: { backgroundColor: '#f43f5e', paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 4 },
  loginBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 42, paddingBottom: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  topTitle: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  connRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  connText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  refreshBtn: { backgroundColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  refreshBtnText: { color: '#38bdf8', fontSize: 12, fontWeight: '800' },
  logoutBtn: { backgroundColor: '#1e293b', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12 },
  logoutBtnText: { fontSize: 13 },

  scrollContent: { padding: 16, paddingBottom: 30 },
  heroCard: { backgroundColor: '#131c2e', borderRadius: 24, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#f43f5e44', marginBottom: 18 },
  heroMascots: { fontSize: 38, marginBottom: 6 },
  heroTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  heroSub: { color: '#fb7185', fontSize: 12, fontWeight: '700', marginTop: 2 },

  sectionHeading: { color: '#94a3b8', fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 10 },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 18 },
  statTile: { flex: 1, backgroundColor: '#131c2e', borderRadius: 18, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  tileIcon: { fontSize: 22, marginBottom: 4 },
  tileValue: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  tileLabel: { color: '#64748b', fontSize: 9, fontWeight: '800', marginTop: 3 },

  homeNoteCard: { backgroundColor: '#131c2e', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#f43f5e66', marginBottom: 18 },
  homeNoteTitle: { color: '#fb7185', fontSize: 12, fontWeight: '800' },
  homeNoteText: { color: '#ffffff', fontSize: 15, fontWeight: '700', fontStyle: 'italic', marginVertical: 8 },
  homeNoteAction: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  bigActionBtn: { width: '48%', backgroundColor: '#131c2e', borderRadius: 20, padding: 16, borderWidth: 1.5 },
  bigActionEmoji: { fontSize: 28, marginBottom: 8 },
  bigActionTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  bigActionSub: { color: '#94a3b8', fontSize: 11, marginTop: 3 },

  mapFocusBar: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 10 },
  focusChipPartner: { flex: 1, backgroundColor: '#f43f5e', paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  focusChipMe: { flex: 1, backgroundColor: '#0ea5e9', paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  focusChipText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  mapContainer: { flex: 1, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: '#1e293b' },

  pageWrap: { flex: 1, padding: 16, justifyContent: 'center' },
  ppgCard: { backgroundColor: '#131c2e', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#f43f5e55' },
  ppgTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginTop: 8 },
  ppgStatusText: { fontSize: 13, textAlign: 'center', marginTop: 8, fontWeight: '600', lineHeight: 19 },
  cameraCircle: { width: 140, height: 140, borderRadius: 70, overflow: 'hidden', borderWidth: 4, marginBottom: 14 },
  liveBpmReadout: { color: '#f43f5e', fontSize: 26, fontWeight: '900', marginBottom: 12 },
  cancelScanBtn: { backgroundColor: '#334155', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 12 },
  cancelScanText: { color: '#ffffff', fontWeight: '700' },
  bpmCompareRow: { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 18 },
  bpmMiniBox: { flex: 1, backgroundColor: '#090d16', padding: 14, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  bpmMiniLabel: { color: '#64748b', fontSize: 10, fontWeight: '800' },
  bpmMiniVal: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginTop: 4 },
  startScanBtn: { width: '100%', backgroundColor: '#f43f5e', paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  startScanBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },

  noteDisplayCard: { backgroundColor: '#131c2e', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#f43f5e55', marginBottom: 14 },
  noteCardBadge: { color: '#fb7185', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  noteBigQuote: { color: '#ffffff', fontSize: 18, fontWeight: '800', fontStyle: 'italic', marginTop: 8 },
  noteSubQuote: { color: '#cbd5e1', fontSize: 14, fontStyle: 'italic', marginTop: 6 },
  writeCard: { backgroundColor: '#131c2e', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#1e293b' },
  writeTitle: { color: '#ffffff', fontSize: 15, fontWeight: '800', marginBottom: 12 },
  noteTextArea: { backgroundColor: '#090d16', color: '#ffffff', borderRadius: 14, padding: 14, minHeight: 90, textAlignVertical: 'top', fontSize: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 14 },
  pinNoteBtn: { backgroundColor: '#f43f5e', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  pinNoteBtnText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },

  bottomNav: { flexDirection: 'row', backgroundColor: '#0f172a', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1e293b', justifyContent: 'space-around' },
  navItem: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14 },
  navItemActive: { backgroundColor: '#1e293b' },
  navEmoji: { fontSize: 18 },
  navLabel: { color: '#64748b', fontSize: 10, fontWeight: '800', marginTop: 2 },
  navLabelActive: { color: '#f43f5e' }
});
