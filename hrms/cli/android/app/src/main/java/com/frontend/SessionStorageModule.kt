package com.frontend

import android.content.Context
import android.content.SharedPreferences
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class SessionStorageModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val preferences: SharedPreferences =
    reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override fun getName(): String = "SessionStorage"

  @ReactMethod
  fun getItem(key: String, promise: Promise) {
    try {
      promise.resolve(preferences.getString(key, null))
    } catch (error: Exception) {
      promise.reject("SESSION_STORAGE_GET_FAILED", error)
    }
  }

  @ReactMethod
  fun setItem(key: String, value: String, promise: Promise) {
    try {
      preferences.edit().putString(key, value).apply()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SESSION_STORAGE_SET_FAILED", error)
    }
  }

  @ReactMethod
  fun removeItem(key: String, promise: Promise) {
    try {
      preferences.edit().remove(key).apply()
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("SESSION_STORAGE_REMOVE_FAILED", error)
    }
  }

  companion object {
    private const val PREFS_NAME = "upanaya_session_storage"
  }
}
