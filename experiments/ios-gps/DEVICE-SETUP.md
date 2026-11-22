# Install the GPS self-test on an iPhone

Open `GpsSelfTest.xcodeproj` on a Mac with Xcode. The downloaded project includes
its Swift source and the exact commit in `SOURCE-COMMIT.txt`.

1. Connect an iPhone running iOS 17 or later, unlock it and complete pairing.
2. In Xcode, select the **GpsSelfTest** target, open **Signing & Capabilities**
   and enable **Automatically manage signing**. Choose the approved Apple
   development team and use a bundle identifier available to that team.
3. Select your iPhone as the run destination and choose **Product → Run**.
   Follow the device prompts if Developer Mode or device registration is needed.
4. Confirm that **GPS Self-Test** opens. Stop the Xcode run, then open the app
   from the iPhone Home Screen for any location measurements.

[Apple’s device setup instructions](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
