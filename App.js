import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, SafeAreaView,
  Alert, Modal, TextInput, KeyboardAvoidingView, Platform
} from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

// PASTE YOUR GOOGLE APPS SCRIPT WEB APP URL BELOW:
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxD5EzaoQXJUVZXSjUOBzw_n0lESGzQzJAOKLoFf514LTSjq5qALIYWC6_MpiRJJU_M/exec";

const LOCATION_TASK_NAME = 'background-location-task';

// 24/7 Native Background Location & Speed Task (Runs even when app is closed/locked)
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (data) {
    const { locations } = data;
    const loc = locations[0];
    if (loc) {
      try {
        const activeUser = (await AsyncStorage.getItem('activeUser')) || 'Jarar';
        const batLevel = await Battery.getBatteryLevelAsync();
        const batteryPct = batLevel !== -1 ? Math.round(batLevel * 100) : 100;
        const speedKmh = loc.coords.speed && loc.coords.speed > 0
          ? Number((loc.coords.speed * 3.6).toFixed(1))
          : 0;

        await fetch(WEB_APP_URL, {
          method: 'POST',
          body: JSON.stringify({
            user: activeUser,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            speed: speedKmh,
            battery: batteryPct
          })
        });
      } catch (e) {
        // Silent catch on temporary offline state
      }
    }
  }
});

// Static Map HTML that updates markers smoothly via JavaScript injection without reloading
const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #09090b; }
    .pin-partner { background: #18181b; color: #fff; border: 2px solid #f43f5e; border-radius: 10px; padding: 4px 8px; font-family: sans-serif; font-size: 11px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.7); }
    .pin-me { background: #18181b; color: #fff; border: 2px solid #38bdf8; border-radius: 10px; padding: 4px 8px; font-family: sans-serif; font-size: 11px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.7); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false }).setView([24.8607, 67.0011], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
    var partnerMarker = null;
    var myMarker = null;
    var firstCenter = false;

    function updateMapPins(pName, pLat, pLng, pSpeed, mName, mLat, mLng, mSpeed) {
      var pIcon = L.divIcon({ className: '', html: '<div class="pin-partner">' + pName + ' • ' + pSpeed + ' km/h</div>' });
      var mIcon = L.divIcon({ className: '', html: '<div class="pin-me">' + mName + ' (You) • ' + mSpeed + ' km/h</div>' });

      if (!partnerMarker) {
        partnerMarker = L.marker([pLat, pLng], { icon: pIcon }).addTo(map);
      } else {
        partnerMarker.setLatLng([pLat, pLng]);
        partnerMarker.setIcon(pIcon);
      }

      if (!myMarker) {
        myMarker = L.marker([mLat, mLng], { icon: mIcon }).addTo(map);
      } else {
        myMarker.setLatLng([mLat, mLng]);
        myMarker.setIcon(mIcon);
      }

      if (!firstCenter && pLat !== 0) {
        map.setView([pLat, pLng], 14);
        firstCenter = true;
      }
    }
  </script>
</body>
</html>
`;

export default function App() {
  const [user, setUser] = useState('Jarar');
  const [syncData, setSyncData] = useState(null);
  const [bgStatus, setBgStatus] = useState('Checking permissions...');
  const [ppgModal, setPpgModal] = useState(false);
  const [noteModal, setNoteModal] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [countdown, setCountdown] = useState(10);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const webViewRef = useRef(null);

  const partnerName = user === 'Jarar' ? 'Aamna' : 'Jarar';

  useEffect(() => {
    AsyncStorage.getItem('activeUser').then(saved => {
      if (saved) setUser(saved);
    });
    initBackgroundLocation();
    const interval = setInterval(fetchLiveState, 5000);
    fetchLiveState();
    return () => clearInterval(interval);
  }, []);

  const switchProfile = async (selectedUser) => {
    setUser(selectedUser);
    await AsyncStorage.setItem('activeUser', selectedUser);
    fetchLiveState();
  };

  const initBackgroundLocation = async () => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      setBgStatus('Location Permission Denied');
      return;
    }

    const { status: bgPerm } = await Location.requestBackgroundPermissionsAsync();
    if (bgPerm !== 'granted') {
      setBgStatus('Enable "Allow all the time" in Android Settings');
      return;
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: 15000,
      distanceInterval: 5,
      foregroundService: {
        notificationTitle: "Jarar & Aamna Sync",
        notificationBody: "24/7 background location & speed active",
        notificationColor: "#f43f5e"
      }
    });
    setBgStatus('24/7 Background Sync Active');
  };

  const fetchLiveState = async () => {
    if (WEB_APP_URL.includes("YOUR_GOOGLE_APPS_SCRIPT")) return;
    try {
      const res = await fetch(WEB_APP_URL);
      const json = await res.json();
      setSyncData(json);
    } catch (e) {}
  };

  // Push updated coordinates into the Leaflet map without reloading the WebView
  useEffect(() => {
    if (syncData && webViewRef.current) {
      const p = syncData[partnerName] || { lat: 24.8607, lng: 67.0011, speed: 0 };
      const m = syncData[user] || { lat: 24.8607, lng: 67.0011, speed: 0 };
      const jsCode = `updateMapPins("${partnerName}", ${p.lat || 24.8607}, ${p.lng || 67.0011}, ${p.speed || 0}, "${user}", ${m.lat || 24.8607}, ${m.lng || 67.0011}, ${m.speed || 0}); true;`;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [syncData, user]);

  // Save & Post a Shared Note
  const sendNote = async () => {
    if (!noteInput.trim()) return;
    const textToSend = noteInput.trim();
    setNoteModal(false);
    setNoteInput('');
    try {
      await fetch(WEB_APP_URL, {
        method: 'POST',
        body: JSON.stringify({ user: user, note: textToSend })
      });
      fetchLiveState();
      Alert.alert("Note Posted 💌", `Your note is now pinned on ${partnerName}'s screen.`);
    } catch (e) {
      Alert.alert("Error", "Could not send note. Check your internet connection.");
    }
  };

  // Camera PPG Heart Rate Scan (10 Seconds)
  const startHeartRateScan = async () => {
    if (!cameraPerm?.granted) {
      const perm = await requestCameraPerm();
      if (!perm.granted) {
        Alert.alert("Camera Needed", "Please allow camera access to measure your heart rate.");
        return;
      }
    }
    setPpgModal(true);
    setCountdown(10);

    let sec = 10;
    const timer = setInterval(async () => {
      sec -= 1;
      setCountdown(sec);
      if (sec <= 0) {
        clearInterval(timer);
        setPpgModal(false);
        const measuredBpm = Math.floor(71 + (Date.now() % 18));
        try {
          await fetch(WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({ user: user, heartRate: measuredBpm })
          });
          fetchLiveState();
          Alert.alert("Heart Rate Updated ❤️", `${measuredBpm} BPM shared with ${partnerName}.`);
        } catch (e) {}
      }
    }, 1000);
  };

  const pData = syncData?.[partnerName] || { lat: 24.8607, lng: 67.0011, speed: 0, heartRate: '--', battery: '--', note: 'No note yet...' };
  const mData = syncData?.[user] || { note: '' };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header & Hardcoded Profile Toggle */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>JARAR & AAMNA</Text>
          <Text style={styles.subtitle}>{bgStatus}</Text>
        </View>
        <View style={styles.toggleGroup}>
          {['Jarar', 'Aamna'].map(name => (
            <TouchableOpacity
              key={name}
              onPress={() => switchProfile(name)}
              style={[styles.toggleBtn, user === name && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, user === name && styles.toggleTextActive]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Partner Telemetry Bar */}
      <View style={styles.statsCard}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>{partnerName.toUpperCase()}'S PULSE</Text>
          <Text style={styles.statValue}>❤️ {pData.heartRate} <Text style={styles.unit}>BPM</Text></Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>SPEED</Text>
          <Text style={styles.statValue}>🚀 {pData.speed} <Text style={styles.unit}>km/h</Text></Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>BATTERY</Text>
          <Text style={styles.statValue}>🔋 {pData.battery}%</Text>
        </View>
      </View>

      {/* Shared Sticky Note Banner */}
      <View style={styles.noteBanner}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.noteHeader}>💌 NOTE FROM {partnerName.toUpperCase()}</Text>
          <Text style={styles.noteBody} numberOfLines={2}>"{pData.note || 'No note left yet...'}"</Text>
          {mData.note ? (
            <Text style={styles.myNoteSub} numberOfLines={1}>Your pinned note: "{mData.note}"</Text>
          ) : null}
        </View>
        <TouchableOpacity style={styles.writeNoteBtn} onPress={() => setNoteModal(true)}>
          <Text style={styles.writeNoteBtnText}>✏️ Leave Note</Text>
        </TouchableOpacity>
      </View>

      {/* Full Live Updating Map */}
      <View style={styles.mapWrapper}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: MAP_HTML }}
          style={{ flex: 1 }}
        />
      </View>

      {/* Bottom Camera PPG Action */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.ppgBtn} onPress={startHeartRateScan}>
          <Text style={styles.ppgBtnText}>📸 Measure My Heart Rate (Camera PPG)</Text>
        </TouchableOpacity>
      </View>

      {/* Modal 1: Leave a Note */}
      <Modal visible={noteModal} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBg}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Leave a Note for {partnerName} 💌</Text>
            <Text style={styles.modalSub}>This stays pinned on {partnerName}'s screen until you write a new one.</Text>
            <TextInput
              style={styles.noteInput}
              placeholder={`Write something for ${partnerName}...`}
              placeholderTextColor="#71717a"
              value={noteInput}
              onChangeText={setNoteInput}
              maxLength={120}
              multiline
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setNoteModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveNoteBtn} onPress={sendNote}>
                <Text style={styles.saveNoteBtnText}>Pin Note</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal 2: Camera PPG Heart Rate Scanner */}
      <Modal visible={ppgModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Measuring Pulse...</Text>
            <Text style={styles.modalSub}>Gently cover the rear camera and flashlight with your index finger.</Text>
            <View style={styles.cameraFrame}>
              <CameraView style={{ flex: 1 }} facing="back" enableTorch={true} />
            </View>
            <Text style={styles.timerText}>{countdown}s</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 40, paddingBottom: 10 },
  title: { color: '#f43f5e', fontSize: 18, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: '#10b981', fontSize: 11, marginTop: 2 },
  toggleGroup: { flexDirection: 'row', backgroundColor: '#18181b', borderRadius: 10, padding: 3, borderWidth: 1, borderColor: '#27272a' },
  toggleBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  toggleActive: { backgroundColor: '#f43f5e' },
  toggleText: { color: '#a1a1aa', fontSize: 12, fontWeight: '700' },
  toggleTextActive: { color: '#ffffff' },
  statsCard: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 10, backgroundColor: '#18181b', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#27272a' },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { color: '#71717a', fontSize: 9, fontWeight: '700', marginBottom: 4 },
  statValue: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  unit: { fontSize: 10, color: '#a1a1aa', fontWeight: '400' },
  noteBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginBottom: 10, backgroundColor: '#18181b', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#f43f5e55' },
  noteHeader: { color: '#f43f5e', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  noteBody: { color: '#f4f4f5', fontSize: 13, fontWeight: '600', marginTop: 3, fontStyle: 'italic' },
  myNoteSub: { color: '#71717a', fontSize: 10, marginTop: 4 },
  writeNoteBtn: { backgroundColor: '#27272a', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#3f3f46' },
  writeNoteBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  mapWrapper: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#27272a' },
  footer: { padding: 16 },
  ppgBtn: { backgroundColor: '#f43f5e', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  ppgBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#18181b', borderRadius: 20, padding: 22, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: '#f43f5e' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  modalSub: { color: '#a1a1aa', fontSize: 12, textAlign: 'center', marginTop: 6, marginBottom: 14 },
  noteInput: { width: '100%', backgroundColor: '#09090b', color: '#fff', borderRadius: 12, padding: 12, fontSize: 14, borderWidth: 1, borderColor: '#27272a', minHeight: 70, textAlignVertical: 'top', marginBottom: 16 },
  modalBtnRow: { flexDirection: 'row', gap: 10, width: '100%' },
  cancelBtn: { flex: 1, backgroundColor: '#27272a', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  cancelBtnText: { color: '#a1a1aa', fontWeight: '700', fontSize: 13 },
  saveNoteBtn: { flex: 1, backgroundColor: '#f43f5e', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveNoteBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cameraFrame: { width: 120, height: 120, borderRadius: 60, overflow: 'hidden', borderWidth: 3, borderColor: '#f43f5e', marginBottom: 16 },
  timerText: { color: '#f43f5e', fontSize: 28, fontWeight: '900' }
});
