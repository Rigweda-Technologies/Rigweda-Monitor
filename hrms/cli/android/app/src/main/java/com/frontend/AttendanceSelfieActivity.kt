package com.frontend

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File

class AttendanceSelfieActivity : AppCompatActivity() {
  private lateinit var previewView: PreviewView
  private var imageCapture: ImageCapture? = null
  private var cameraProvider: ProcessCameraProvider? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)

    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.BLACK)
    }

    previewView = PreviewView(this).apply {
      scaleType = PreviewView.ScaleType.FILL_CENTER
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }

    root.addView(
      previewView,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )

    val closeButton = Button(this).apply {
      text = "Close"
      setOnClickListener { finishCancelled() }
    }
    root.addView(
      closeButton,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        topMargin = 48
        leftMargin = 32
      }
    )

    val captureButton = Button(this).apply {
      text = "Capture"
      setOnClickListener { capturePhoto() }
    }
    root.addView(
      captureButton,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
      ).apply {
        gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        bottomMargin = 64
      }
    )

    setContentView(root)
    startCamera()
  }

  override fun onBackPressed() {
    finishCancelled()
  }

  private fun startCamera() {
    val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
    cameraProviderFuture.addListener(
      {
        try {
          cameraProvider = cameraProviderFuture.get()
          bindFrontCamera()
        } catch (error: Exception) {
          showError("Unable to open selfie camera.")
          finishCancelled()
        }
      },
      ContextCompat.getMainExecutor(this)
    )
  }

  private fun bindFrontCamera() {
    val provider = cameraProvider ?: return

    val preview = Preview.Builder()
      .setTargetRotation(previewView.display?.rotation ?: windowManager.defaultDisplay.rotation)
      .build()
      .also {
        it.setSurfaceProvider(previewView.surfaceProvider)
      }

    imageCapture = ImageCapture.Builder()
      .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
      .setTargetRotation(previewView.display?.rotation ?: windowManager.defaultDisplay.rotation)
      .build()

    try {
      provider.unbindAll()
      provider.bindToLifecycle(
        this,
        CameraSelector.DEFAULT_FRONT_CAMERA,
        preview,
        imageCapture
      )
    } catch (error: Exception) {
      showError("Unable to open selfie camera.")
      finishCancelled()
    }
  }

  private fun capturePhoto() {
    val capture = imageCapture
    if (capture == null) {
      showError("Selfie camera is still starting.")
      return
    }

    val outputFile = File(cacheDir, "attendance_selfie_${System.currentTimeMillis()}.jpg")
    val outputOptions = ImageCapture.OutputFileOptions.Builder(outputFile).build()

    capture.takePicture(
      outputOptions,
      ContextCompat.getMainExecutor(this),
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
          setResult(
            Activity.RESULT_OK,
            Intent().putExtra(EXTRA_FILE_PATH, outputFile.absolutePath)
          )
          finish()
        }

        override fun onError(exception: ImageCaptureException) {
          showError("Could not capture selfie. Please try again.")
        }
      }
    )
  }

  private fun finishCancelled() {
    setResult(Activity.RESULT_CANCELED)
    finish()
  }

  private fun showError(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
  }

  companion object {
    const val EXTRA_FILE_PATH = "attendance_selfie_file_path"
  }
}
