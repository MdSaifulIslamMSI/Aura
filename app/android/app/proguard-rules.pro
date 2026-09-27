# App-level R8 rules. Capacitor ships consumer rules that keep the
# JS-bridge plugin surface (@com.getcapacitor.annotation annotations and
# Plugin subclasses); Firebase and Facebook AARs ship their own consumer
# rules. The entries below are the deliberate app-level additions.

# Keep line numbers so release stack traces map through
# app/build/outputs/mapping/release/mapping.txt.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Belt and suspenders for the bridge surface: the Capacitor core classes
# and the Capacitor Firebase authentication plugin (the plugin classes are
# already covered by the capacitor-android consumer rules, but an explicit
# keep costs almost nothing and survives consumer-rule drift).
-keep class com.getcapacitor.** { *; }
-keep class io.capawesome.capacitorjs.plugins.firebase.authentication.** { *; }

# The Cordova compatibility layer is resolved reflectively by Capacitor.
-keep class org.apache.cordova.** { *; }

# Optional transitive references that R8 flags once shrinking is on.
-dontwarn com.facebook.**
-dontwarn org.apache.http.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
