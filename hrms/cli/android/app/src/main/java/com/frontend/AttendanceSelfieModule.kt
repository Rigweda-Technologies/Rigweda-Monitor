package com.frontend

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import kotlin.math.max

class AttendanceSelfieModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  private var pendingPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "AttendanceSelfie"

  @ReactMethod
  fun captureSelfie(promise: Promise) {
    if (pendingPromise != null) {
      promise.reject("ATTENDANCE_SELFIE_BUSY", "Selfie capture is already in progress.")
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("ATTENDANCE_SELFIE_NO_ACTIVITY", "Activity is not available.")
      return
    }

    if (ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("ATTENDANCE_SELFIE_PERMISSION", "Camera permission is required.")
      return
    }

    pendingPromise = promise
    val intent = Intent(activity, AttendanceSelfieActivity::class.java)
    activity.startActivityForResult(intent, REQUEST_CODE_CAPTURE)
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE_CAPTURE) {
      return
    }

    val promise = pendingPromise ?: return
    pendingPromise = null

    if (resultCode != Activity.RESULT_OK) {
      promise.reject("ATTENDANCE_SELFIE_CANCELLED", "Selfie capture cancelled.")
      return
    }

    val filePath = data?.getStringExtra(AttendanceSelfieActivity.EXTRA_FILE_PATH)
    if (filePath.isNullOrBlank()) {
      promise.reject("ATTENDANCE_SELFIE_NO_FILE", "Selfie capture failed.")
      return
    }

    try {
      val compressedBytes = compressSelfie(filePath)
      val base64 = Base64.encodeToString(compressedBytes, Base64.NO_WRAP)
      promise.resolve("data:image/jpeg;base64,$base64")
    } catch (error: Exception) {
      promise.reject("ATTENDANCE_SELFIE_READ_FAILED", error)
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun compressSelfie(filePath: String): ByteArray {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(filePath, bounds)

    val decodeOptions = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, 360, 360)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }

    val decoded = BitmapFactory.decodeFile(filePath, decodeOptions)
      ?: throw IllegalStateException("Unable to decode selfie image.")

    try {
      var quality = 70
      var outputBytes: ByteArray

      do {
        val output = ByteArrayOutputStream()
        decoded.compress(Bitmap.CompressFormat.JPEG, quality, output)
        outputBytes = output.toByteArray()
        quality -= 10
      } while (outputBytes.size > MAX_SELFIE_BYTES && quality >= 30)

      return outputBytes
    } finally {
      decoded.recycle()
    }
  }

  private fun calculateInSampleSize(width: Int, height: Int, reqWidth: Int, reqHeight: Int): Int {
    var inSampleSize = 1
    var halfHeight = height / 2
    var halfWidth = width / 2

    while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
      inSampleSize *= 2
    }

    return max(1, inSampleSize)
  }

  companion object {
    private const val REQUEST_CODE_CAPTURE = 44891
    private const val MAX_SELFIE_BYTES = 220 * 1024
  }
}



