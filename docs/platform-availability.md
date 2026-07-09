# Platform Availability

Aura is available through the strongest runtime each platform can realistically support.

## Full App Surfaces

- Web/PWA: Vercel, Netlify, and AWS CloudFront serve the same production storefront.
- Desktop: Windows, macOS, and Linux packages ship through the desktop release lane.
- Mobile: the current mobile release lane publishes an Android debug APK and an iOS simulator ZIP. Store-signed Android AAB and real-device iOS/iPadOS IPA artifacts require signing, provisioning, and distribution setup before they can be presented as installable packages.

## Current Release Asset Contract

Aura's global availability promise is operational, not a claim that one binary runs everywhere. The gateway must keep these lanes distinct.

| Surface | Current gateway state | Expected asset | User-facing behavior |
| --- | --- | --- | --- |
| Windows | Ready native desktop | exact `.exe` setup/portable release assets | Direct GitHub release download after hydration |
| macOS | Ready native desktop | exact `.dmg` and `.zip` release assets | Direct GitHub release download after hydration |
| Linux | Ready native desktop | exact AppImage, deb, RPM, and tar.gz release assets | Direct GitHub release download after hydration |
| Android device testing | Ready mobile test build | Android debug APK | Direct GitHub release download after hydration, labeled as debug/testing |
| iOS simulator testing | Ready simulator build | iOS simulator ZIP | Direct GitHub release download after hydration, labeled as simulator/testing |
| Android Play release | Not published in current release | AAB | Disabled as `Not published` until a real AAB asset exists |
| iPhone/iPad real-device install | Not published in current release | signed IPA | Disabled as `Not published` until a real signed IPA asset exists |
| Modern browser platforms | PWA/web route | no native binary | Use the hosted Aura PWA |
| Long-tail and embedded OS families | PWA or companion/API mode | no native binary | Use hosted browser access where available; otherwise use authenticated backend/API integration |

Do not add a gateway download button for a platform-specific binary until a real release asset exists. New native claims must ship with a matching GitHub release artifact, gateway resolver metadata, and this matrix update in the same pull request.

## Requested Platform Coverage

| Platform | Aura surface | Notes |
| --- | --- | --- |
| iPadOS | PWA today, signed IPA when Apple signing is configured | Safari users can add Aura to the Home Screen. A real-device IPA still requires Apple signing and provisioning. |
| ChromeOS | PWA today, Android APK on compatible devices | ChromeOS users should install the hosted PWA from Chrome. APK testing depends on Chromebook Android compatibility. |
| Ubuntu | Native Linux deb, AppImage, hosted PWA | Ubuntu users should choose the deb package for normal installs or AppImage for portable use. |
| Fedora | Native Linux RPM, AppImage, hosted PWA | Fedora users should choose the RPM package for normal installs or AppImage for portable use. |
| Unix / BSD | Hosted PWA in a modern browser | Linux has native desktop packages. BSD and illumos-style systems should use the browser/PWA lane unless a separate native build target is added later. |
| HarmonyOS | Hosted PWA today, APK testing on Android-compatible devices | A native HarmonyOS HAP package needs a separate HarmonyOS project and Huawei signing pipeline. |
| FreeRTOS / RTOS family | Companion/client integration only | RTOS devices cannot run the full React marketplace UI. They can call Aura backend APIs or communicate through an HTTPS/MQTT bridge for device status, telemetry, inventory signals, and lightweight commerce events. |
| watchOS | Companion integration only | Apple Watch can receive alerts and quick actions through a paired Apple device; it cannot run the full marketplace UI. |
| tvOS | Browser/display surface, future native TV app lane | Apple TV support is large-screen browsing/display today; a native tvOS app requires a separate remote-first UX and App Store lane. |
| Red Hat Enterprise Linux | Native Linux RPM, AppImage, hosted PWA | RHEL users should choose the RPM package for desktop installs or the PWA from managed browsers on servers/cloud systems. |
| VxWorks | Companion/client integration only | VxWorks real-time devices should use authenticated telemetry/event APIs or a gateway bridge; checkout and account workflows stay on full Aura surfaces. |
| Linux / GNU-Linux family | AppImage, deb, RPM, tar.gz, hosted PWA | The broad GNU-Linux family is covered by generic Linux packages plus the browser/PWA lane. |
| SUSE Linux Enterprise | RPM, AppImage, hosted PWA | Enterprise SUSE environments should use RPM/AppImage for desktop installs and PWA for managed server/cloud access. |
| openSUSE | RPM, AppImage, hosted PWA | openSUSE desktops and developer systems should use RPM/AppImage or install the PWA from a browser. |
| Raspberry Pi OS | ARM64 AppImage/deb where compatible, hosted PWA, companion API | Raspberry Pi OS is Debian-based; lower-resource Pi/IoT deployments should prefer browser/PWA or companion API use. |
| Sailfish OS | Hosted web/PWA, possible Android-compatibility testing | Sailfish is covered primarily through compatible mobile browsers; Android compatibility is device/policy dependent. |
| MINIX | Browser/PWA where available, companion API | MINIX is treated as an education/research OS surface, not a native desktop packaging target. |
| RISC OS | Browser/PWA where available, companion API | RISC OS support depends on browser capability; otherwise use companion/API integration. |
| Symbian OS | Legacy fallback only | Symbian-era devices lack the modern browser baseline for the full Aura UI; use a modern companion device. |
| Mageia | RPM, AppImage, hosted PWA | Mageia users should use RPM/AppImage on desktop or PWA on server/browser setups. |
| Astra Linux | RPM/deb/AppImage where policy permits, hosted PWA | Secure government/enterprise deployments should choose packages according to local certification policy or use managed browser access. |
| ALT Linux / ALT OS | RPM/AppImage, hosted PWA | ALT desktop/server deployments can use RPM/AppImage; mobile variants should use browser/PWA where available. |
| RED OS | RPM/AppImage, hosted PWA | Certified workstation/server installs should follow enterprise policy and prefer RPM or PWA. |
| Aurora OS | Hosted mobile web/PWA | Native Aurora app packaging would require a separate SDK, signing, and corporate distribution lane. |
| KasperskyOS | Companion/client integration only | Secure microkernel deployments should integrate through authenticated device/event APIs, not full UI hosting. |
| ROSA Linux | RPM/AppImage, hosted PWA | ROSA desktop/server users should use RPM/AppImage or PWA. |
| Elbrus Linux / Elbrus OS | Hosted PWA/browser route | The current pipeline does not emit native Elbrus CPU binaries. |
| Calculate Linux | AppImage, tar.gz, hosted PWA | Gentoo-based users should use AppImage/tar.gz or PWA; no ebuild is published. |
| KolibriOS | Companion/research fallback only | KolibriOS is too small for the full Aura UI; use backend API or gateway bridge integration. |
| Phantom OS | Companion/research fallback only | Phantom OS is experimental; use companion/API integration rather than full storefront hosting. |
| HarmonyOS / Hongmeng OS | Hosted PWA, Android-compatible APK testing where allowed | Phones, tablets, TVs, wearables, cars, and IoT devices use the browser/PWA lane unless a separate native Harmony package is built. |
| OpenHarmony | Companion/client integration, browser/PWA where available | Embedded and distributed OpenHarmony devices should use backend APIs or gateway bridges unless they expose a modern browser. |
| Kylin OS / Galaxy Kylin | deb/RPM/AppImage, hosted PWA | Government, defence, enterprise desktop/server deployments should use approved Linux package policy or managed browser access. |
| UOS / UnionTech OS | deb/AppImage, hosted PWA | UOS desktops and servers are covered by Linux packages and the PWA. |
| openEuler | RPM/AppImage, hosted PWA | Server/cloud/edge systems should prefer browser/PWA or gateway use; desktop sessions can use RPM/AppImage. |
| deepin Linux | deb/AppImage, hosted PWA | Consumer desktop users should use deb/AppImage or install Aura as a PWA. |
| AliOS / AliOS Things | Companion/client integration, browser/PWA where available | Smart car, industrial, and lightweight embedded devices should integrate through scoped backend events. |
| Anolis OS | RPM/AppImage, hosted PWA | Enterprise cloud/server systems should use RPM/AppImage where desktop UI is needed, otherwise managed browser/PWA. |
| TencentOS Server | RPM/AppImage, hosted PWA | Tencent Cloud/server workloads should use managed browser access or gateway integration. |
| RT-Thread | Companion/client integration only | RTOS microcontroller and sensor devices should use telemetry/event APIs, not the full Aura UI. |

## Indian OS Coverage

| Platform | Aura surface | Notes |
| --- | --- | --- |
| BOSS Linux | Debian-compatible deb, AppImage, hosted PWA | Government/FOSS deployments can use the Linux deb package or the browser/PWA lane. |
| EduBOSS | Debian-compatible deb, AppImage, hosted PWA | Education labs should prefer managed browser/PWA installs unless desktop packaging is approved locally. |
| BOSS Advanced Server / Server edition | Hosted PWA from a managed browser | Server editions should not run the desktop UI as a daemon; use Aura from an admin browser session. |
| Secure BOSS | Debian-compatible deb or hosted PWA | Controlled deployments should follow local endpoint policy before installing desktop binaries. |
| Maya OS | Ubuntu-compatible deb, AppImage, hosted PWA | Maya OS is covered through the Ubuntu-compatible Linux lane; defence environments may require additional review. |
| BharOS | Android APK where compatible, hosted PWA | BharOS is not a normal mass-market Android replacement, so APK support depends on the organization's packaging policy. |
| JioOS | Android-family APK where compatible, hosted PWA | JioBook users can use the PWA immediately and test APK compatibility where allowed. |
| JioTele OS | TV browser/PWA surface | A native smart-TV app needs a separate TV packaging and remote-control UX lane. |
| Indus OS / Indus Appstore ecosystem | Android APK/Appstore lane where compatible, hosted PWA | Existing Android package output can be used as the base artifact for Indus distribution review. |
| Garuda Linux | AppImage, tar.gz, hosted PWA | Arch-based users should use AppImage or tar.gz; no native pacman package is published yet. |

## PWA Behavior

- The manifest is tablet and desktop friendly, with standalone display, broad orientation support, app shortcuts, and install metadata.
- The service worker is intentionally network-first for navigations so new deployments take priority over cached HTML.
- Static hashed assets can be cached for repeat launches.
- API, realtime, and upload routes are not cached by the service worker.

## RTOS Boundary

Keep account login, checkout, payment, and admin workflows on web, desktop, or mobile. RTOS firmware should only send or receive scoped operational signals through authenticated backend endpoints or a gateway bridge.
