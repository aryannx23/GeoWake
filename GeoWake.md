# 📍 GeoWake — Location-Based Smart Alarm

> **Wake up when you reach your destination, not at a fixed time.**

GeoWake is a mobile application that allows users to create a **location-based alarm**. Instead of setting an alarm for a specific time, the user selects a destination and an alert radius. The application continuously monitors the user's location in the background and triggers a loud alarm when the user approaches the destination.

### Example

A user is traveling by train from **Chennai to Bangalore** and wants to sleep during the journey.

They configure:

```text
Destination: Bangalore Railway Station
Alert radius: 500 meters
Alarm: Loud + Vibration
```

The user starts the trip and goes to sleep.

When the phone detects that the user is approximately 500 meters from the destination, the application triggers the alarm.

---

# 1. Project Goal

Build a reliable Android application that can:

1. Accept a destination from the user.
2. Obtain the destination's latitude and longitude.
3. Allow the user to select an alert radius.
4. Track the user's location while the application is running in the background.
5. Calculate the distance between the current location and destination.
6. Detect when the user enters the configured radius.
7. Trigger a loud alarm even when the phone screen is locked.
8. Continue working while the user is sleeping and the application is not visible.
9. Prevent false alarms caused by GPS inaccuracies as much as reasonably possible.
10. Provide a simple, clean interface suitable for everyday use.

---

# 2. Target Platform

## Primary Platform

**Android**

The first version should be Android-native.

### Recommended technology

```text
Language: Kotlin
IDE: Android Studio
UI: Jetpack Compose
Architecture: MVVM / Clean Architecture
Minimum Android version: Android 8+ where practical
Target SDK: Latest stable Android SDK
Database: Room
Location: Android Fused Location Provider
Background tracking: Foreground Service
Dependency Injection: Hilt
Async operations: Kotlin Coroutines + Flow
```

Do not build the core functionality as a website.

A web application/PWA may not reliably provide the required background location and alarm behavior.

---

# 3. Core User Flow

The application should follow this flow:

```text
OPEN APP
   ↓
HOME SCREEN
   ↓
CREATE LOCATION ALARM
   ↓
SELECT DESTINATION
   ↓
SELECT ALERT DISTANCE
   ↓
CONFIGURE ALARM
   ↓
REVIEW
   ↓
START TRIP
   ↓
REQUEST REQUIRED PERMISSIONS
   ↓
START BACKGROUND LOCATION SERVICE
   ↓
USER LOCKS PHONE / SLEEPS
   ↓
LOCATION UPDATES
   ↓
CALCULATE DISTANCE
   ↓
DISTANCE <= ALERT RADIUS?
      ↓
    NO ───────→ Continue tracking
      ↓
     YES
      ↓
TRIGGER ALARM
      ↓
USER WAKES UP
      ↓
STOP ALARM
      ↓
TRIP COMPLETED
```

---

# 4. Main Features

## 4.1 Create Location Alarm

The user should be able to create a new alarm.

Required fields:

```text
Destination
Alert radius
Alarm sound
Vibration
Alarm duration
Trip name (optional)
```

Example:

```text
Destination:
Bangalore Railway Station

Alert me within:
500 meters

Alarm:
Default Alarm

Vibration:
ON
```

---

# 5. Destination Selection

The user must be able to select a destination in multiple ways.

## Option A — Search

Provide a search field:

```text
Search destination...
```

Example:

```text
Bangalore Railway Station
```

Search results should display:

```text
Bangalore City Railway Station
KSR Bengaluru City Junction
Bangalore Cantonment
...
```

The user selects one.

---

## Option B — Select From Map

Display an interactive map.

The user can:

```text
Search location
Zoom
Pan
Drop pin
Confirm destination
```

---

## Option C — Use Coordinates

Advanced option:

```text
Latitude:
12.9776

Longitude:
77.5706
```

This can be hidden under an "Advanced" section.

---

# 6. Maps

The project should avoid unnecessary dependency on Google Maps.

Prefer an open-source/free map stack where practical.

Recommended:

```text
OpenStreetMap
+
MapLibre or Leaflet-compatible Android solution
```

A commercial map provider can be added later if required.

Important:

The map provider and geocoding provider are separate concerns.

---

# 7. Geocoding

The application needs to convert:

```text
"Bangalore Railway Station"
```

into:

```text
Latitude
Longitude
```

Possible providers:

- Nominatim/OpenStreetMap
- Photon
- MapTiler
- Other suitable geocoding provider

The implementation should use an abstraction:

```text
GeocodingService
```

so the provider can be replaced later.

Do not hard-code the application around one provider.

---

# 8. Location Tracking

This is the most important component of the application.

The app must obtain the user's current location.

Use:

```text
Android Fused Location Provider
```

The service should obtain:

```text
Latitude
Longitude
Accuracy
Timestamp
Speed
Bearing
Altitude (optional)
```

Example:

```json
{
  "latitude": 13.0827,
  "longitude": 80.2707,
  "accuracy": 12.5,
  "speed": 21.3,
  "bearing": 87.2,
  "timestamp": 1788250000
}
```

---

# 9. Background Location

The application MUST continue tracking when:

- Screen is locked
- Application is minimized
- User switches to another application
- Phone is in the user's pocket
- User is sleeping
- The display is turned off

Use an Android:

```text
Foreground Service
```

with an appropriate persistent notification.

Example:

```text
GeoWake
Trip active

Destination:
Bangalore Railway Station

Distance:
3.7 km

Tracking location...
```

---

# 10. Permissions

The application must correctly request Android permissions.

Potential permissions include:

```text
ACCESS_FINE_LOCATION
ACCESS_COARSE_LOCATION
ACCESS_BACKGROUND_LOCATION
FOREGROUND_SERVICE
FOREGROUND_SERVICE_LOCATION
POST_NOTIFICATIONS
VIBRATE
WAKE_LOCK
```

Only request permissions that are actually required for the target Android version.

The application should explain WHY each important permission is needed.

Example:

> "GeoWake needs background location access so it can wake you when you approach your destination even while your screen is locked."

Never request permissions unnecessarily.

---

# 11. Location Permission Flow

The permission flow should be user-friendly.

Example:

```text
Location Permission
       ↓
Allow While Using
       ↓
Explain Background Tracking
       ↓
Request Background Location if required
       ↓
Notification Permission
       ↓
Ready
```

If the user denies a required permission, show a clear explanation and a button:

```text
Open Settings
```

Do not repeatedly spam permission requests.

---

# 12. Distance Calculation

The application must calculate the distance between:

```text
Current GPS location
        ↓
Destination coordinates
```

Use the Android location APIs where appropriate, such as:

```text
Location.distanceBetween()
```

or an equivalent accurate geographic-distance implementation.

The distance should be calculated in meters.

Example:

```text
Current location
↓
Destination

Distance = 742 meters
```

If alert radius:

```text
500 meters
```

then:

```text
742 > 500

DO NOT ALARM
```

Later:

```text
Current distance = 487 meters

487 <= 500

TRIGGER ALARM
```

---

# 13. Alert Radius

Allow the user to choose:

```text
100 m
200 m
300 m
500 m
1 km
2 km
5 km
Custom
```

Custom radius should support meters/kilometers.

Example:

```text
Alert me within:

[ 500 ] [ meters ▼ ]
```

---

# 14. GPS Accuracy Handling

GPS is not perfectly accurate.

The application MUST NOT blindly trigger an alarm from one inaccurate GPS reading.

Example:

```text
GPS reading #1
Distance: 510m
Accuracy: ±80m

GPS reading #2
Distance: 495m
Accuracy: ±70m

GPS reading #3
Distance: 480m
Accuracy: ±35m
```

The app should use sensible validation/hysteresis before triggering.

Possible strategy:

```text
Distance <= radius
AND
GPS accuracy is acceptable
AND
condition persists for multiple location updates
```

For example:

Require 2–3 consecutive qualifying readings.

This should be configurable internally and tuned during testing.

---

# 15. Important: Avoid False Triggers

The app must account for GPS jumps.

Example:

```text
Current distance = 4 km

GPS suddenly reports:
Current distance = 300 m

Next reading:
Current distance = 3.8 km
```

Do NOT trigger the alarm.

Implement basic filtering / validation.

Potential techniques:

- Accuracy threshold
- Consecutive location confirmation
- Distance consistency
- Speed consistency
- Timestamp validation
- Ignore obviously impossible jumps
- Optional Kalman/filtering approach if necessary

Do not over-engineer the first version.

---

# 16. Train Travel Consideration

The application is specifically useful for train travel.

A simple radius-based system has a potential problem:

```text
                DESTINATION
                    🚉
                    ●
                   / \
                  /   \
                 /     \
Train track ────●───────
               🚆
```

The train could pass within 500 meters of the destination without actually stopping there.

Therefore, the architecture should be designed so that future versions can support:

```text
Destination radius
+
Approach direction
+
Route awareness
```

However, the MVP should initially use:

```text
GPS distance + accuracy validation
```

Do not make railway routing a requirement for version 1.

---

# 17. Alarm System

When the destination condition is satisfied:

```text
TRIGGER ALARM
```

The alarm should:

- Play a loud sound
- Vibrate
- Show a full-screen alarm UI where Android permits it
- Work with the screen locked
- Continue until dismissed/snoozed
- Bring the user into the alarm screen
- Clearly display the destination

Example:

```text
╔══════════════════════════╗
║                          ║
║       🚨 WAKE UP 🚨      ║
║                          ║
║   You are near:         ║
║                          ║
║ Bangalore Railway       ║
║ Station                 ║
║                          ║
║ Distance: ~430 m        ║
║                          ║
║     [ STOP ALARM ]      ║
║                          ║
╚══════════════════════════╝
```

---

# 18. Alarm Sound

Provide built-in alarm sounds.

Example:

```text
Default
Loud Alarm
Beep
Emergency
Gentle
```

Allow the user to choose a sound.

Future feature:

```text
Choose custom audio file
```

---

# 19. Vibration

Settings:

```text
Vibration:
ON / OFF
```

Possible pattern:

```text
500ms ON
300ms OFF
500ms ON
300ms OFF
...
```

Use Android's modern vibration APIs where appropriate.

---

# 20. Alarm Volume

The app should respect Android's audio rules.

Do not assume that simply setting a volume value will always work.

The application should:

- Detect relevant audio state
- Explain if volume is too low
- Use an appropriate alarm/audio stream
- Follow Android platform restrictions

Optional warning:

```text
⚠ Your alarm volume appears low.
Increase volume for reliable alerts.
```

---

# 21. Active Trip Screen

After starting an alarm, display:

```text
DESTINATION

Bangalore Railway Station

Distance:
12.4 km

Alert radius:
500 m

Status:
🟢 Tracking

GPS accuracy:
±18 m

Estimated speed:
72 km/h
```

Also provide:

```text
[ Stop Trip ]
```

---

# 22. Lock Screen Experience

The user should be able to:

```text
Start trip
↓
Lock phone
↓
Sleep
↓
App remains active
↓
Destination reached
↓
Alarm appears
```

The implementation must comply with Android's background execution restrictions.

---

# 23. Battery Optimization

Continuous GPS can consume battery.

The application should balance:

```text
Accuracy
vs
Battery consumption
```

Use adaptive location intervals.

For example:

```text
Far from destination
↓
Lower update frequency

Near destination
↓
Higher update frequency
```

Possible concept:

```text
> 10 km:
low frequency

1–10 km:
medium frequency

< 1 km:
high frequency
```

These values should be configurable in code.

---

# 24. Smart Location Frequency

Example:

```text
Distance > 10 km
→ location update every ~60 sec

Distance 2–10 km
→ every ~20–30 sec

Distance < 2 km
→ every ~5–10 sec
```

These are starting points, NOT fixed requirements.

Optimize through testing.

Do not use extremely aggressive GPS polling unnecessarily.

---

# 25. Battery Safety

Provide an optional setup check:

```text
Battery optimization detected

For reliable destination alarms, Android may need
GeoWake to be excluded from battery optimization.

[ Fix Settings ]
[ Continue Anyway ]
```

The application must clearly explain that Android manufacturers may impose additional background restrictions.

Do not claim that the app can guarantee operation after the user force-stops it.

---

# 26. Important Android Limitation

The application cannot guarantee location tracking if the user:

```text
Force Stops the application
```

or disables required permissions/location services.

The app should handle this gracefully.

Example:

```text
⚠ Trip tracking stopped

Location permission or background execution
is no longer available.

[ Open Settings ]
```

---

# 27. Active Alarm Persistence

If the phone/app is restarted, the application should attempt to recover active trips where technically possible.

Store active trip information locally:

```text
destination
latitude
longitude
radius
alarm settings
trip status
created time
```

Use:

```text
Room Database
```

or DataStore for appropriate settings/state.

---

# 28. Home Screen

Design a simple home screen.

Example:

```text
┌────────────────────────────┐
│          GeoWake           │
│                            │
│  📍 Location Alarm         │
│                            │
│  Wake up when you arrive.  │
│                            │
│      [ CREATE ALARM ]      │
│                            │
│  Active Trips              │
│  ─────────────────────     │
│  Bangalore Railway Station │
│  12.4 km away               │
│  🟢 Tracking                │
│                            │
│  History                    │
│  Settings                   │
└────────────────────────────┘
```

---

# 29. Alarm Creation UI

Suggested flow:

### Step 1

```text
Where do you want to wake up?

[ Search destination... ]

       OR

[ Pick on Map ]
```

### Step 2

```text
Destination

Bangalore Railway Station

Coordinates:
12.xxxxx, 77.xxxxx

[ Confirm ]
```

### Step 3

```text
Wake me when I am within:

○ 100 m
○ 200 m
● 500 m
○ 1 km
○ 2 km
○ Custom
```

### Step 4

```text
Alarm Settings

Sound: Default Alarm
Vibration: ON
Repeat: ON

[ START TRIP ]
```

### Step 5

Show confirmation:

```text
Ready!

Destination:
Bangalore Railway Station

Alarm:
500 m radius

[ START TRACKING ]
```

---

# 30. Trip History

Store completed alarms.

Example:

```text
Trip History

Bangalore Railway Station
Completed
500 m
September 1, 2026

Chennai Central
Completed
200 m
August 29, 2026
```

Users should be able to delete history.

---

# 31. Saved Destinations

Allow users to save frequently used destinations.

Example:

```text
⭐ Home
⭐ College
⭐ Chennai Central
⭐ Bangalore Railway Station
```

When creating an alarm:

```text
[ Saved Places ]
```

---

# 32. Recent Destinations

Show recent locations to make repeated trips easier.

Example:

```text
Recent

Bangalore Railway Station
Chennai Central
Airport
College
```

---

# 33. Destination Favorites

Users should be able to mark locations as favorites.

Store:

```text
name
latitude
longitude
optional address
```

---

# 34. Notification

While a trip is active, show a persistent notification:

```text
📍 GeoWake

Destination:
Bangalore Railway Station

Distance:
3.4 km

Tracking active
```

Actions:

```text
STOP
```

Optionally:

```text
VIEW
```

---

# 35. Offline Behavior

The core alarm mechanism should work without continuous internet access **after the destination coordinates have already been obtained**, because distance calculation only requires GPS coordinates.

Example:

```text
Internet:
OFF

GPS:
ON

Destination coordinates:
Stored

Distance calculation:
WORKS
```

However:

```text
Destination search
```

may require internet unless cached/offline data is available.

This distinction must be clearly implemented.

---

# 36. GPS vs Internet

Important architectural rule:

```text
GPS location
≠
Internet location
```

The application should not require an internet connection just to calculate distance.

Use device location services.

Internet is primarily required for:

- Destination search
- Geocoding
- Map tiles
- Optional route information

---

# 37. Location Service Architecture

Recommended architecture:

```text
UI
 │
 ▼
ViewModel
 │
 ▼
TripRepository
 │
 ├── LocationService
 │       │
 │       └── Fused Location Provider
 │
 ├── DistanceCalculator
 │
 ├── AlarmManager
 │
 ├── NotificationManager
 │
 └── Room Database
```

---

# 38. Suggested Project Structure

```text
app/
│
├── data/
│   ├── local/
│   │   ├── AppDatabase.kt
│   │   ├── TripDao.kt
│   │   └── TripEntity.kt
│   │
│   ├── remote/
│   │   └── GeocodingService.kt
│   │
│   └── repository/
│       └── TripRepository.kt
│
├── domain/
│   ├── model/
│   │   ├── Destination.kt
│   │   ├── Trip.kt
│   │   └── AlarmConfig.kt
│   │
│   └── usecase/
│       ├── CalculateDistance.kt
│       ├── StartTrip.kt
│       ├── StopTrip.kt
│       └── TriggerAlarm.kt
│
├── location/
│   ├── LocationService.kt
│   └── LocationRepository.kt
│
├── alarm/
│   ├── AlarmManager.kt
│   ├── AlarmReceiver.kt
│   └── AlarmActivity.kt
│
├── notification/
│   └── NotificationHelper.kt
│
├── ui/
│   ├── home/
│   ├── createalarm/
│   ├── destination/
│   ├── activeTrip/
│   ├── alarm/
│   ├── history/
│   └── settings/
│
└── MainActivity.kt
```

---

# 39. Data Model

## Trip

```text
Trip
----------------------------
id
destinationName
latitude
longitude
alertRadiusMeters
alarmSound
vibrationEnabled
status
createdAt
startedAt
completedAt
```

Possible status:

```text
DRAFT
ACTIVE
TRIGGERED
COMPLETED
CANCELLED
```

---

# 40. Settings

Provide:

```text
Default alert radius
Default alarm sound
Vibration
Theme
Units
Location accuracy preference
Battery-saving mode
```

Units:

```text
Meters / Kilometers
```

---

# 41. Dark Mode

Support:

```text
Light
Dark
System Default
```

Use Material 3 design.

---

# 42. UI/UX Requirements

The UI should be:

- Minimal
- Modern
- Fast
- Accessible
- Easy to understand while tired
- Large touch targets
- High contrast
- Minimal unnecessary animations

The most important action should always be obvious:

```text
CREATE ALARM
```

and during a trip:

```text
STOP TRIP
```

---

# 43. Safety / Reliability

The application should display a warning:

> GeoWake relies on GPS and device/system conditions. GPS accuracy can vary, especially inside trains, buildings, tunnels, or areas with poor satellite visibility. Do not rely on the application as your only method of ensuring you leave at a destination.

This is particularly important for train travel.

---

# 44. GPS Failure Handling

If GPS becomes unavailable:

```text
⚠ GPS signal unavailable
```

The application should continue trying.

If location has not been received for a significant period:

```text
⚠ Location unavailable

Your destination alarm may not trigger reliably.

Check that Location is enabled.
```

---

# 45. Location Accuracy UI

Show:

```text
GPS Accuracy

Excellent
±8 m
```

or:

```text
Poor
±150 m
```

Use appropriate thresholds rather than misleading precision.

---

# 46. Mock Location Detection

During development/testing, detect mock locations where possible.

This is useful for testing but should not unnecessarily block normal users.

---

# 47. Testing Requirements

The project MUST include tests.

## Unit Tests

Test:

```text
Distance calculation
Radius comparison
GPS filtering
Trip state changes
Alarm trigger conditions
```

Example:

```text
Destination:
0,0

Current:
approximately 400m away

Radius:
500m

Expected:
TRIGGER
```

---

# 48. Edge Cases

Test:

### Case 1

User is already inside the radius when starting.

Expected behavior should be explicitly defined.

Recommended:

```text
Show confirmation:

"You are already within 500m of this destination."

[ Trigger Now ]
[ Cancel ]
```

---

### Case 2

GPS jumps suddenly.

Expected:

```text
Ignore suspicious reading.
```

---

### Case 3

User moves away after entering radius.

The alarm should already have triggered once.

---

### Case 4

No internet.

If destination coordinates are already stored:

```text
Tracking continues.
```

---

### Case 5

GPS disabled.

Show warning.

---

### Case 6

Battery extremely low.

Show warning but do not unnecessarily stop tracking.

---

### Case 7

Phone restarted.

Attempt to restore active trip.

---

### Case 8

Application force-stopped.

Clearly explain that Android prevents background execution until the app is opened again.

---

### Case 9

User changes destination during an active trip.

Require confirmation:

```text
Stop current trip and create a new one?
```

---

### Case 10

Multiple alarms.

Version 1 may support only one active trip.

Design architecture so multiple trips can be supported later.

---

# 49. MVP Scope

The first version MUST focus on reliability rather than excessive features.

### MVP features

```text
✅ Destination search
✅ Destination selection
✅ Map
✅ GPS tracking
✅ Background foreground-service tracking
✅ Distance calculation
✅ Alert radius
✅ Alarm
✅ Vibration
✅ Notification
✅ Lock-screen alarm
✅ Trip start/stop
✅ Basic history
✅ Permission handling
✅ GPS error handling
✅ Battery-aware location updates
```

Do NOT make these mandatory for MVP:

```text
❌ Social features
❌ Accounts
❌ Cloud synchronization
❌ AI
❌ Chat
❌ Railway API integration
❌ Complex route planning
❌ User registration
```

---

# 50. Version 2 Features

After MVP is reliable:

```text
Smart route awareness
Train/bus travel mode
ETA estimation
Multiple active alarms
Cloud backup
User accounts
Saved trips
Automatic trip detection
Location sharing
Travel history
Custom alarm audio
Offline maps
Widgets
Wear OS support
```

---

# 51. Advanced Smart Alarm

Future feature:

Instead of:

```text
500m radius
```

allow:

```text
Wake me approximately 5 minutes before
reaching my destination.
```

The app could estimate:

```text
Distance
+
Speed
+
Direction
+
Route
```

to estimate arrival.

Example:

```text
Destination:
Bangalore Railway Station

Estimated arrival:
7:42 AM

Wake-up:
7:37 AM
```

This should be implemented only after the basic location-radius system is reliable.

---

# 52. Train Mode

Future train-specific mode:

```text
🚆 TRAIN MODE
```

The user enters:

```text
Origin:
Chennai Central

Destination:
Bangalore

Train:
Optional
```

The app can use:

```text
GPS
+
railway station coordinates
+
route information
```

to improve destination detection.

Potential future feature:

```text
Approaching Bangalore Railway Station
↓
1 km
↓
500 m
↓
200 m
↓
ALARM
```

---

# 53. Route-Aware Detection

Future architecture should allow:

```text
Distance-to-destination
```

to be replaced/combined with:

```text
Distance-to-route destination
```

and:

```text
Approach direction
```

This prevents the "passing near destination without actually arriving" problem.

---

# 54. API Abstraction

Do not hard-code third-party APIs directly throughout the project.

Use interfaces.

Example:

```kotlin
interface GeocodingProvider {
    suspend fun search(query: String): List<Place>
}
```

This allows:

```text
Nominatim
MapTiler
Mapbox
HERE
Google
```

to be swapped later.

---

# 55. Secrets/API Keys

Never commit API keys to GitHub.

Bad:

```text
const val API_KEY = "abc123..."
```

Good:

```text
local.properties
BuildConfig
environment variables
secure configuration
```

Add sensitive files to:

```text
.gitignore
```

---

# 56. Security

The application should:

- Minimize stored location data
- Store only information required for functionality
- Avoid uploading location history by default
- Clearly explain location permissions
- Never expose API keys
- Use HTTPS for network communication
- Avoid unnecessary analytics

Privacy should be a core design principle.

---

# 57. Privacy Model

MVP should preferably operate locally.

```text
GPS
 ↓
Phone
 ↓
Distance calculation
 ↓
Alarm
```

No server should be required for the core alarm functionality.

Destination search may use a remote geocoding service.

---

# 58. Error Messages

Use understandable messages.

Bad:

```text
LocationException: PROVIDER_DISABLED
```

Good:

```text
Location is turned off.

Please enable Location Services for GeoWake to track your journey.
```

---

# 59. Developer Debug Screen

Create a hidden/debug screen during development.

Display:

```text
GPS:
ON

Latitude:
13.xxxxx

Longitude:
80.xxxxx

Accuracy:
±12m

Speed:
64 km/h

Destination:
12.xxxxx, 77.xxxxx

Distance:
3.42 km

Radius:
500m

Tracking:
ACTIVE

Last update:
5 seconds ago

Alarm:
NOT TRIGGERED
```

This will be extremely useful when testing the application.

---

# 60. Simulated Location Testing

Because physically traveling hundreds of kilometers is inconvenient, development must support simulated GPS locations.

Provide a debug-only feature:

```text
SIMULATE LOCATION

Current:
10 km away

[ Move to 5 km ]
[ Move to 1 km ]
[ Move to 500 m ]
[ Move to 200 m ]
[ Trigger Alarm ]
```

Alternatively use Android Studio's emulator location simulation.

---

# 61. Logging

Use structured logs during development.

Example:

```text
[GeoWake]
Location update received

Lat: ...
Lng: ...
Accuracy: 14m

Distance to destination: 742m

Alert radius: 500m

Condition: FALSE
```

When triggering:

```text
[GeoWake]
Distance threshold reached

Distance: 482m
Radius: 500m
Accuracy: 18m

Triggering alarm...
```

Do not log sensitive location information unnecessarily in production.

---

# 62. Performance

The application should:

- Avoid unnecessary network calls
- Avoid excessive GPS polling
- Avoid memory leaks
- Stop services after trip completion
- Release resources properly
- Avoid unnecessary UI recompositions
- Use coroutines appropriately

---

# 63. Application States

Implement a clear state machine:

```text
IDLE
 ↓
CONFIGURING
 ↓
READY
 ↓
TRACKING
 ↓
DESTINATION_NEAR
 ↓
ALARMING
 ↓
COMPLETED
```

Possible cancellation:

```text
TRACKING → CANCELLED
```

Error:

```text
TRACKING → LOCATION_UNAVAILABLE
```

---

# 64. Alarm Trigger Logic

Conceptual logic:

```text
IF trip.status != ACTIVE
    do nothing

GET current location

IF location unavailable
    continue monitoring

IF accuracy is unacceptable
    ignore reading

CALCULATE distance

IF distance <= alertRadius
    validate condition

IF condition remains valid
    trigger alarm

SET trip.status = TRIGGERED
```

The alarm must only trigger once per trip.

---

# 65. Don't Depend on Exact GPS Distance

The system should NOT assume:

```text
GPS distance = exact physical distance
```

Instead:

```text
GPS position
+
accuracy
+
multiple readings
+
reasonable filtering
```

should determine whether the destination threshold has actually been reached.

---

# 66. Build Requirements

The final project should build successfully using:

```text
Gradle
Android Studio
Kotlin
```

There should be no:

```text
TODO
placeholder implementation
fake location service
fake alarm
broken API
hardcoded destination
```

in the production path.

---

# 67. README Requirements

The generated repository must include a proper README containing:

```text
Project overview
Features
Architecture
Tech stack
Setup instructions
API configuration
Permissions
How background tracking works
How to run
How to test
Known limitations
Privacy
Future roadmap
```

---

# 68. GitHub Requirements

Recommended repository structure:

```text
GeoWake/
│
├── app/
├── screenshots/
├── docs/
├── README.md
├── LICENSE
├── .gitignore
└── settings.gradle.kts
```

Commit regularly.

Suggested commits:

```text
Initial Android project
Add home UI
Add destination search
Add map
Add location service
Add distance calculation
Add foreground tracking
Add alarm system
Add permission handling
Add trip history
Add testing
Release MVP
```

---

# 69. Development Order

Build the application in this order:

## Phase 1 — Project

```text
Create Android project
Configure Kotlin
Configure Compose
Configure dependencies
```

## Phase 2 — UI

```text
Home
Create Alarm
Destination
Active Trip
Alarm
Settings
```

## Phase 3 — Location

```text
Request permission
Get GPS
Display coordinates
Display accuracy
```

## Phase 4 — Distance

```text
Destination coordinates
Current coordinates
Distance calculation
Radius detection
```

## Phase 5 — Background

```text
Foreground Service
Persistent notification
Background location
Screen-lock testing
```

## Phase 6 — Alarm

```text
Alarm audio
Vibration
Full-screen alarm
Stop button
```

## Phase 7 — Maps

```text
Map
Destination search
Geocoding
Pin selection
```

## Phase 8 — Persistence

```text
Room
Trip history
Saved destinations
Settings
```

## Phase 9 — Reliability

```text
GPS filtering
Battery optimization
Error handling
Restart recovery
```

## Phase 10 — Testing

```text
Unit tests
Emulator tests
Simulated GPS
Real-world testing
```

---

# 70. Acceptance Criteria

The MVP is considered successful if:

### Test 1

User creates:

```text
Destination: Location A
Radius: 500m
```

Application starts tracking.

---

### Test 2

Screen is locked.

Application continues receiving location updates.

---

### Test 3

Device approaches destination.

At approximately the configured radius:

```text
Alarm triggers.
```

---

### Test 4

GPS produces a single inaccurate reading inside the radius.

```text
Alarm must NOT immediately trigger.
```

---

### Test 5

Multiple valid readings show the user inside the radius.

```text
Alarm triggers.
```

---

### Test 6

Internet is disabled after destination selection.

```text
GPS tracking continues.
Distance calculation continues.
Alarm continues to work.
```

---

### Test 7

User cancels trip.

```text
Location service stops.
Notification disappears.
Alarm will not trigger.
```

---

### Test 8

User restarts the phone.

The application should attempt to recover the active trip where technically possible and clearly communicate if manual restart is required.

---

# 71. Final Product Vision

The long-term vision is:

> **A smart travel alarm that lets people sleep without worrying about missing their destination.**

Instead of:

```text
"What time will I reach Bangalore?"
```

the user simply says:

```text
"Wake me when I'm near Bangalore."
```

The application handles:

```text
GPS
+
Location
+
Distance
+
Background tracking
+
Battery management
+
Alarm
```

automatically.

---

# 72. Instructions to the Coding AI

When implementing this project:

1. **Do not create a fake/demo implementation.**
2. Implement real Android GPS functionality.
3. Implement real background/foreground-service location tracking.
4. Implement a real alarm mechanism.
5. Handle Android permissions correctly.
6. Do not assume the application can run after force-stop.
7. Do not hard-code API keys.
8. Use dependency injection and clean separation between services.
9. Keep the core distance calculation independent of the map provider.
10. Make the application work without internet after destination coordinates have been obtained.
11. Prioritize reliability over visual complexity.
12. Test screen-locked/background behavior.
13. Include proper error handling.
14. Include unit tests for distance and trigger logic.
15. Include a debug mode for simulated locations.
16. Keep third-party services replaceable through interfaces.
17. Do not add unnecessary login/account functionality to the MVP.
18. Do not upload user location data unless explicitly required.
19. Explain any Android platform limitation rather than pretending it does not exist.
20. Build the project incrementally and verify that each phase compiles before moving to the next phase.

---

# 73. Recommended MVP Technology Stack

```text
Platform
Android

Language
Kotlin

UI
Jetpack Compose + Material 3

Architecture
MVVM / Clean Architecture

Location
Google Fused Location Provider

Background
Android Foreground Service

Database
Room

Settings
DataStore

Async
Kotlin Coroutines + Flow

Maps
MapLibre / suitable OpenStreetMap-compatible solution

Geocoding
Provider abstraction
(Nominatim/MapTiler/etc.)

Dependency Injection
Hilt

Testing
JUnit
AndroidX Test
Compose UI Test

Build
Gradle Kotlin DSL
```

---

# 74. Most Important Requirement

The application is **not primarily a map application**.

The core product is:

```text
             DESTINATION
                  ↓
             Coordinates
                  ↓
              GPS
                  ↓
        Background Tracking
                  ↓
         Distance Calculation
                  ↓
         Radius Verification
                  ↓
             🔔 ALARM
```

The map is only a supporting feature.

**Reliability of the location alarm is the highest priority.**

---

# 75. Project Name

Suggested name:

# GeoWake

Tagline:

> **Sleep. Travel. We'll wake you when you arrive.**

Alternative names:

```text
GeoWake
WakeNear
ReachAlarm
LocAlarm
NearWake
TravelWake
WakePoint
ArriveAlarm
GeoAlarm
StopWake
```

**Preferred name: GeoWake**