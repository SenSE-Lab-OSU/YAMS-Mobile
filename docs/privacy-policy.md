# YAMS Mobile — Privacy Policy

**Last updated: 5 August 2026**

YAMS Mobile is a research data-collection app developed by the SenSE Lab at
The Ohio State University. It is used by research staff to collect accelerometer
measurements from MotionSenSE wristband devices during studies.

This policy explains what the app does and does not do with information.

## Summary

**YAMS Mobile does not collect any personal information, and no data ever
leaves your device.** The app has no accounts, no analytics, no advertising, no
tracking, and makes no network connections. Everything it records is written to
local storage on the device and stays there until you remove it.

## Information stored on the device

When you run a collection session, the app writes the following to local files
on the device:

- **Measurement data** — for each sample received from a wristband: the ENMO
  value, the sample counter, and a reconstructed device timestamp.
- **Session details** — the subject and session numbers you enter (for example
  `sub-1000` / `ses-00`), the numeric participant encoding derived from them,
  the Bluetooth names and identifiers of the wristbands used, and the session
  start time.

These are written as plain text files and a `session_info.json` manifest inside
a `yams-mobile-data` folder — in the app's Documents directory on iOS, and in
the Downloads folder on Android.

Subject and session numbers are study-assigned identifiers entered by research
staff. The app never asks for and never stores names, contact details, dates of
birth, or any other directly identifying information. It has no way to link a
number to a person; that mapping exists only in the study's own records.

## Information sent off the device

**None.** The app makes no network requests. It does not upload measurements,
does not contact any server operated by us or anyone else, and contains no
third-party analytics, crash-reporting, or advertising components.

Files are retrieved by research staff manually — through the Files app on iOS,
or the Downloads folder on Android — and any subsequent handling is governed by
the study protocol, not by this app.

## Permissions

- **Bluetooth** — required to discover and connect to MotionSenSE wristbands and
  to receive measurements from them. This is the app's core function.
- **Location (Android 11 and earlier only)** — older versions of Android require
  the location permission before an app may scan for Bluetooth devices at all.
  YAMS Mobile does not use it to determine, record, or transmit your location,
  and declares `neverForLocation` on its Bluetooth scan permission. On Android
  12 and later this permission is not requested. The iOS version does not use
  location in any form.
- **Storage (Android 9 and earlier only)** — needed to write session files to
  the Downloads folder.

## Data retention and deletion

Session files remain on the device until deleted. You can remove them at any
time by deleting the `yams-mobile-data` folder through the Files app (iOS) or a
file manager (Android), or by uninstalling the app, which removes everything it
stored on iOS.

Because no data reaches us, we cannot access, correct, export, or delete data on
your behalf. Study participants with questions about how their data is handled
after collection should contact the research team running the study.

## Children

YAMS Mobile is a tool for research staff and is not directed at children. It
does not knowingly collect information from anyone.

## Changes to this policy

If this policy changes, the "Last updated" date above will change with it. If
the app ever begins transmitting data off the device, this policy will be
updated before that version ships.

## University policies

Research conducted with this app is also subject to The Ohio State University's
institutional privacy policies, published at
<https://it.osu.edu/privacy/privacy-policies>. Those policies govern the
university's handling of personal information generally; this policy describes
the app itself, which stores its data only on the device and transmits nothing.

## Contact

SenSE Lab, The Ohio State University

- Email: <chang.1560@osu.edu>
