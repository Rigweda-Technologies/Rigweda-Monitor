import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { getApiWithToken, putApiWithToken } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';

type UploadPayload = {
  fileName: string;
  mimeType: string;
  base64Data: string;
};

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RELATION_OPTIONS = [
  'Father',
  'Mother',
  'Spouse',
  'Brother',
  'Sister',
  'Son',
  'Daughter',
  'Guardian',
  'Friend',
  'Other',
];

type SelectionFieldKey = 'gender' | 'bloodGroup' | 'emergencyRelation';

type AndroidPermissionValue = typeof PermissionsAndroid.PERMISSIONS[keyof typeof PermissionsAndroid.PERMISSIONS];

const requestAndroidPermission = async (permission: AndroidPermissionValue) => {
  const granted = await PermissionsAndroid.request(permission);
  return granted === PermissionsAndroid.RESULTS.GRANTED;
};

const requestPhotoPermission = async () => {
  if (Platform.OS !== 'android') return true;
  const perm =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
  return requestAndroidPermission(perm);
};

const requestCameraPermission = async () => {
  if (Platform.OS !== 'android') return true;
  return requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
};

const FONT_REGULAR = Platform.select({ android: 'sans-serif', ios: 'System', default: 'sans-serif' });
const FONT_MEDIUM = Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'sans-serif' });

function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const { session, updateProfile, refreshPermissions } = useAuth();
  const token = session?.token || '';
  const permissions = useMemo(() => session?.permissions || [], [session?.permissions]);
  const canViewDepartment = permissions.includes('DEPT_VIEW');
  const canViewDesignation = permissions.includes('DESIG_VIEW');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [error, setError] = useState('');
  const [editVisible, setEditVisible] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [resolvedCanEditProfile, setResolvedCanEditProfile] = useState(false);
  useResetScrollOnFocus(scrollViewRef);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateValue, setStateValue] = useState('');
  const [country, setCountry] = useState('');
  const [zip, setZip] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [profileImage, setProfileImage] = useState<UploadPayload | null>(null);
  const [addressProofUpload, setAddressProofUpload] = useState<UploadPayload | null>(null);
  const [selectionField, setSelectionField] = useState<SelectionFieldKey | null>(null);
  const permissionSignature = permissions.join('|');
  const canRenderEditProfile =
    permissionsReady && resolvedCanEditProfile && permissions.includes('EMP_SELF_EDIT');

  const openSelection = (field: SelectionFieldKey) => setSelectionField(field);
  const closeSelection = () => setSelectionField(null);

  const handleSelection = (value: string) => {
    if (selectionField === 'gender') setGender(value);
    if (selectionField === 'bloodGroup') setBloodGroup(value);
    if (selectionField === 'emergencyRelation') setEmergencyRelation(value);
    closeSelection();
  };

  const selectionConfig = useMemo(() => {
    if (selectionField === 'gender') {
      return {
        title: 'Select Gender',
        options: GENDER_OPTIONS,
        value: gender,
      };
    }
    if (selectionField === 'bloodGroup') {
      return {
        title: 'Select Blood Group',
        options: BLOOD_GROUP_OPTIONS,
        value: bloodGroup,
      };
    }
    if (selectionField === 'emergencyRelation') {
      return {
        title: 'Select Relationship',
        options: RELATION_OPTIONS,
        value: emergencyRelation,
      };
    }
    return null;
  }, [selectionField, gender, bloodGroup, emergencyRelation]);

  const seedForm = (data: any | null) => {
    setFirstName(data?.firstName || '');
    setLastName(data?.lastName || '');
    setPhone(data?.phone || '');
    setDob(data?.dob ? String(data.dob).slice(0, 10) : '');
    setGender(data?.gender || '');
    setBloodGroup(data?.bloodGroup || '');
    setLine1(data?.address?.line1 || '');
    setLine2(data?.address?.line2 || '');
    setCity(data?.address?.city || '');
    setStateValue(data?.address?.state || '');
    setCountry(data?.address?.country || '');
    setZip(data?.address?.zip || '');
    const contact = Array.isArray(data?.emergencyContacts) ? data.emergencyContacts[0] : null;
    setEmergencyName(contact?.name || '');
    setEmergencyRelation(contact?.relation || '');
    setEmergencyPhone(contact?.phone || '');
    setProfileImage(null);
    setAddressProofUpload(null);
  };

  const loadProfile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await getApiWithToken('/employees/me', token);
    setLoading(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to load profile');
      return;
    }
    setProfile(res.data || null);
    seedForm(res.data || null);
  }, [token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setPermissionsReady(false);
      setResolvedCanEditProfile(false);
      refreshPermissions()
        .then((nextPermissions) => {
          if (active) {
            setResolvedCanEditProfile(nextPermissions.includes('EMP_SELF_EDIT'));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) {
            setPermissionsReady(true);
          }
        });
      return () => {
        active = false;
      };
    }, [refreshPermissions])
  );

  useEffect(() => {
    if ((!permissionsReady || !resolvedCanEditProfile) && editVisible) {
      setEditVisible(false);
    }
  }, [editVisible, permissionsReady, resolvedCanEditProfile]);

  useEffect(() => {
    if (!permissions.includes('EMP_SELF_EDIT')) {
      setResolvedCanEditProfile(false);
    }
  }, [permissions]);

  const employmentRows = useMemo(
    () =>
      [
        { label: 'Employee Code', value: profile?.employeeCode },
        canViewDepartment
          ? { label: 'Department', value: profile?.departmentId?.name }
          : null,
        canViewDesignation
          ? { label: 'Designation', value: profile?.designationId?.name }
          : null,
        { label: 'Employment Type', value: profile?.employmentType },
        {
          label: 'Date Of Joining',
          value: profile?.dateOfJoining ? String(profile.dateOfJoining).slice(0, 10) : '',
        },
        {
          label: 'Reporting Manager',
          value: profile?.managerId
            ? `${profile.managerId.firstName || ''} ${profile.managerId.lastName || ''}`.trim()
            : '',
        },
      ].filter(Boolean) as Array<{ label: string; value: string }>,
    [profile, canViewDepartment, canViewDesignation]
  );

  const addressLabel = useMemo(() => {
    const parts = [
      profile?.address?.line1,
      profile?.address?.line2,
      profile?.address?.city,
      profile?.address?.state,
      profile?.address?.country,
      profile?.address?.zip,
    ]
      .filter(Boolean)
      .join(', ');
    return parts;
  }, [profile]);

  const personalRows = useMemo(
    () => [
      { label: 'Work Email', value: profile?.userId?.email },
      { label: 'Phone', value: profile?.phone },
      { label: 'DOB', value: profile?.dob ? String(profile.dob).slice(0, 10) : '' },
      { label: 'Gender', value: profile?.gender },
      { label: 'Blood Group', value: profile?.bloodGroup },
      { label: 'Address', value: addressLabel },
      {
        label: 'Address Proof',
        value: profile?.addressProof?.fileUrl ? 'Uploaded' : 'Not uploaded',
      },
    ],
    [profile, addressLabel]
  );

  const pickImage = async (mode: 'camera' | 'library') => {
    setError('');
    if (mode === 'camera') {
      const ok = await requestCameraPermission();
      if (!ok) {
        setError('Camera permission required.');
        return;
      }
    } else {
      const ok = await requestPhotoPermission();
      if (!ok) {
        setError('Photo permission required.');
        return;
      }
    }
    const result =
      mode === 'camera'
        ? await launchCamera({
            mediaType: 'photo',
            includeBase64: true,
            quality: 0.7,
            maxWidth: 720,
            maxHeight: 720,
          })
        : await launchImageLibrary({
            mediaType: 'photo',
            includeBase64: true,
            quality: 0.7,
            maxWidth: 720,
            maxHeight: 720,
          });
    const asset = result.assets?.[0];
    if (!asset?.base64 || !asset?.type) return;
    setProfileImage({
      fileName: asset.fileName || `profile-${Date.now()}.jpg`,
      mimeType: asset.type,
      base64Data: asset.base64,
    });
  };

  const pickAddressProof = async () => {
    setError('');
    const ok = await requestPhotoPermission();
    if (!ok) {
      setError('Photo permission required.');
      return;
    }
    const result = await launchImageLibrary({
      mediaType: 'photo',
      includeBase64: true,
      quality: 0.7,
      maxWidth: 1200,
      maxHeight: 1200,
    });
    const asset = result.assets?.[0];
    if (!asset?.base64 || !asset?.type) return;
    setAddressProofUpload({
      fileName: asset.fileName || `address-proof-${Date.now()}.jpg`,
      mimeType: asset.type,
      base64Data: asset.base64,
    });
  };

  const handleSave = async () => {
    if (!canRenderEditProfile) {
      setError('You do not have permission to edit your profile.');
      setEditVisible(false);
      return;
    }

    if (!phone || !dob || !gender || !line1 || !city || !stateValue || !country || !zip) {
      setError('Please fill the required fields.');
      return;
    }
    setSaving(true);
    setError('');
    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      phone,
      dob,
      gender,
      bloodGroup: bloodGroup || undefined,
      address: {
        line1,
        line2,
        city,
        state: stateValue,
        country,
        zip,
      },
      emergencyContacts: emergencyName
        ? [
            {
              name: emergencyName,
              relation: emergencyRelation || 'Contact',
              phone: emergencyPhone || phone,
            },
          ]
        : [],
    };
    if (profileImage) {
      payload.profileImageUpload = profileImage;
    }
    if (addressProofUpload) {
      payload.addressProofUpload = addressProofUpload;
    }
    const res = await putApiWithToken('/employees/me/profile', payload, token);
    setSaving(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to save profile.');
      return;
    }

    setEditVisible(false);
    await loadProfile();
    updateProfile(res.data || profile);
  };

  const profileImageUrl = profile?.profileImage;
  const displayName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Employee';

  return (
    <LinearGradient
      key={`profile:${permissionSignature}`}
      colors={['#f3f5f9', '#f3f5f9', '#eef1f6']}
      style={styles.container}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, 16) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.detailCard}>
            <ActivityIndicator color="#2563eb" />
            <Text style={styles.helperText}>Loading profile...</Text>
          </View>
        ) : (
          <>
            <LinearGradient
              colors={['#ffffff', '#f7f9fd']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerCard}
            >
              <LinearGradient
                colors={['#1d4ed8', '#2563eb', '#4f46e5']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.headerAccent}
              />
              <View style={styles.headerContent}>
                <View style={styles.photoWrap}>
                  {profileImageUrl ? (
                    <Image source={{ uri: profileImageUrl }} style={styles.photo} />
                  ) : (
                    <View style={styles.placeholder}>
                      <Text style={styles.placeholderText}>{displayName.charAt(0)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.headerText}>
                  <Text style={styles.headerName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <View style={styles.headerEmailRow}>
                    <MaterialCommunityIcons name="email-outline" size={14} color="#64748b" />
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                      {profile?.userId?.email || ''}
                    </Text>
                  </View>
                  {canRenderEditProfile ? (
                    <Pressable style={styles.editButton} onPress={() => setEditVisible(true)}>
                      <LinearGradient colors={['#f8fbff', '#eef4ff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.editButtonInner}>
                        <MaterialCommunityIcons name="pencil-outline" size={14} color="#2563eb" />
                        <Text style={styles.editButtonText}>Edit Profile</Text>
                      </LinearGradient>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </LinearGradient>

            <LinearGradient colors={['#ffffff', '#f8fafc']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.detailCard, styles.cardSpacing]}>
              <Text style={styles.cardTitle}>Employment Details</Text>
              {employmentRows.map((row) => (
                <LinearGradient key={row.label} colors={['#ffffff', '#f9fbfe']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{row.label}</Text>
                  <Text style={styles.detailColon}>:</Text>
                  <Text style={styles.detailValue}>{row.value || '-'}</Text>
                </LinearGradient>
              ))}
            </LinearGradient>

            <LinearGradient colors={['#ffffff', '#f8fafc']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.detailCard, styles.cardSpacing]}>
              <Text style={styles.cardTitle}>Personal Details</Text>
              {personalRows.map((row) => (
                <LinearGradient key={row.label} colors={['#ffffff', '#f9fbfe']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{row.label}</Text>
                  <Text style={styles.detailColon}>:</Text>
                  <Text style={styles.detailValue}>{row.value || '-'}</Text>
                </LinearGradient>
              ))}
            </LinearGradient>
          </>
        )}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <Modal visible={canRenderEditProfile && editVisible} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <LinearGradient colors={['#ffffff', '#f7f9fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <Pressable style={styles.closeBadge} onPress={() => setEditVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color="#0f172a" />
              </Pressable>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Profile Picture</Text>
                <View style={styles.profilePicRow}>
                  <View style={styles.profilePicWrapper}>
                    {profileImage ? (
                      <Image
                        source={{ uri: `data:${profileImage.mimeType};base64,${profileImage.base64Data}` }}
                        style={styles.profilePicImage}
                        resizeMode="cover"
                      />
                    ) : profileImageUrl ? (
                      <Image source={{ uri: profileImageUrl }} style={styles.profilePicImage} resizeMode="cover" />
                    ) : (
                      <MaterialCommunityIcons name="account" size={32} color="#64748b" />
                    )}
                  </View>
                  <View style={styles.profilePicActions}>
                    <Pressable style={styles.uploadButton} onPress={() => pickImage('camera')}>
                      <LinearGradient colors={['#f8fafc', '#eef2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.uploadButtonInner}>
                        <Text style={styles.uploadButtonText}>Camera</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable style={styles.uploadButton} onPress={() => pickImage('library')}>
                      <LinearGradient colors={['#f8fafc', '#eef2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.uploadButtonInner}>
                        <Text style={styles.uploadButtonText}>Gallery</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.helperText}>
                  {profileImage?.fileName || profileImageUrl ? profileImage?.fileName || 'Selected image' : 'Choose profile picture (JPG, PNG, WEBP up to 2MB)'}
                </Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter phone number"
                  placeholderTextColor="#94a3b8"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Date of Birth</Text>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#94a3b8"
                  value={dob}
                  onChangeText={setDob}
                />
              </View>

              <View style={styles.pickerRow}>
                <View style={styles.pickerField}>
                  <Text style={styles.fieldLabel}>Gender</Text>
                  <Pressable style={styles.selectField} onPress={() => openSelection('gender')}>
                    <Text style={[styles.selectFieldText, !gender && styles.selectPlaceholder]}>
                      {gender || 'Select gender'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
                  </Pressable>
                </View>
                <View style={[styles.pickerField, styles.pickerFieldGap]}>
                  <Text style={styles.fieldLabel}>Blood Group</Text>
                  <Pressable onPress={() => openSelection('bloodGroup')} style={styles.selectField}>
                    <Text style={[styles.selectFieldText, !bloodGroup && styles.selectPlaceholder]}>
                      {bloodGroup || 'Optional'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
                  </Pressable>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Address Line 1</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter address line 1"
                  placeholderTextColor="#94a3b8"
                  value={line1}
                  onChangeText={setLine1}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Address Line 2</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter address line 2"
                  placeholderTextColor="#94a3b8"
                  value={line2}
                  onChangeText={setLine2}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter city"
                  placeholderTextColor="#94a3b8"
                  value={city}
                  onChangeText={setCity}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>State</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter state"
                  placeholderTextColor="#94a3b8"
                  value={stateValue}
                  onChangeText={setStateValue}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Country</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter country"
                  placeholderTextColor="#94a3b8"
                  value={country}
                  onChangeText={setCountry}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>ZIP / PIN</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter ZIP / PIN"
                  placeholderTextColor="#94a3b8"
                  value={zip}
                  onChangeText={setZip}
                  keyboardType="number-pad"
                />
              </View>
              <Pressable style={styles.fileButton} onPress={pickAddressProof}>
                <LinearGradient colors={['#ffffff', '#f6f9fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fileButtonInner}>
                  <Text style={styles.fileButtonText}>
                    {addressProofUpload?.fileName || 'Choose Address Proof'}
                  </Text>
                </LinearGradient>
              </Pressable>
              <Text style={styles.fileHelperText}>PDF, JPG, PNG, WEBP up to 5MB</Text>

              <Text style={[styles.sectionTitle, styles.sectionTitleSpacing]}>Emergency Contact</Text>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Contact Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter contact name"
                  placeholderTextColor="#94a3b8"
                  value={emergencyName}
                  onChangeText={setEmergencyName}
                />
              </View>
              <View style={styles.pickerRow}>
                <View style={styles.pickerField}>
                  <Text style={styles.fieldLabel}>Relationship</Text>
                  <Pressable
                    style={styles.selectField}
                    onPress={() => openSelection('emergencyRelation')}
                  >
                    <Text
                      style={[
                        styles.selectFieldText,
                        !emergencyRelation && styles.selectPlaceholder,
                      ]}
                    >
                      {emergencyRelation || 'Select'}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={18} color="#64748b" />
                  </Pressable>
                </View>
                <View style={[styles.pickerField, styles.pickerFieldGap]}>
                  <Text style={styles.fieldLabel}>Contact Phone</Text>
                  <TextInput
                    style={[styles.input, styles.inputNoMargin]}
                    placeholder="Enter phone"
                    placeholderTextColor="#94a3b8"
                    value={emergencyPhone}
                    onChangeText={setEmergencyPhone}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <Pressable style={styles.primaryButton} onPress={handleSave} disabled={saving}>
                <LinearGradient colors={['#2563eb', '#2563eb', '#1d4ed8']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.primaryButtonInner}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save Profile</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </LinearGradient>
        </View>
      </Modal>

      <Modal visible={Boolean(selectionConfig)} transparent animationType="fade">
        <Pressable style={styles.selectionBackdrop} onPress={closeSelection}>
          <Pressable style={styles.selectionCard} onPress={() => undefined}>
            <View style={styles.selectionHeader}>
              <Text style={styles.selectionTitle}>{selectionConfig?.title || 'Select'}</Text>
              <Pressable onPress={closeSelection}>
                <MaterialCommunityIcons name="close" size={20} color="#0f172a" />
              </Pressable>
            </View>
            <ScrollView style={styles.selectionList} showsVerticalScrollIndicator={false}>
              {selectionConfig?.options.map((option) => {
                const selected = selectionConfig.value === option;
                return (
                  <Pressable
                    key={option}
                    style={[styles.selectionItem, selected && styles.selectionItemActive]}
                    onPress={() => handleSelection(option)}
                  >
                    <Text
                      style={[
                        styles.selectionItemText,
                        selected && styles.selectionItemTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                    {selected ? (
                      <MaterialCommunityIcons name="check" size={18} color="#2563eb" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  headerCard: {
    padding: 14,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 4, height: 8 },
    elevation: 5,
  },
  headerAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 84,
    borderTopRightRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 6,
  },
  photoWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    marginRight: 14,
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  photo: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { fontSize: 24, color: '#64748b' },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
    paddingRight: 6,
  },
  headerName: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  headerEmailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerSubtitle: { flex: 1, fontSize: 12, color: '#64748b' },
  editButton: {
    marginTop: 2,
    alignSelf: 'flex-start',
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: '#f8fbff',
    shadowColor: '#c9d5e8',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  editButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  editButtonText: { color: '#2563eb', fontWeight: '700', fontSize: 13 },
  detailCard: {
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 7 },
    elevation: 4,
  },
  cardSpacing: {
    marginTop: 16,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#d6deeb',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  detailLabel: { width: 110, fontSize: 12, color: '#475569' },
  detailColon: { width: 12, textAlign: 'center', fontSize: 12, color: '#475569' },
  detailValue: { flex: 1, fontSize: 12, color: '#0f172a', fontWeight: '600', textAlign: 'left' },
  helperText: { marginTop: 8, fontSize: 12, color: '#475569' },
  errorText: { marginTop: 12, color: '#dc2626', textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  modalContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  closeBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d4ddec',
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  section: { marginTop: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 6 },
  sectionTitleSpacing: { marginTop: 24 },
  profilePicRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  profilePicWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#ffffff',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: -2, height: -2 },
    elevation: 1,
  },
  profilePicImage: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  profilePicActions: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  uploadButton: {
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    flex: 1,
    marginLeft: 4,
    shadowColor: '#c9d5e8',
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  uploadButtonInner: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadButtonText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  fieldGroup: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#334155',
    marginBottom: 6,
    fontFamily: FONT_MEDIUM,
  },
  input: {
    height: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    marginBottom: 0,
    color: '#0f172a',
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    shadowColor: '#d6deeb',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  inputNoMargin: {
    marginBottom: 0,
  },
  pickerRow: { flexDirection: 'row', marginBottom: 10 },
  pickerField: {
    flex: 1,
  },
  pickerFieldGap: {
    marginLeft: 12,
  },
  selectField: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#d6deeb',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  selectFieldText: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    fontFamily: FONT_REGULAR,
  },
  selectPlaceholder: {
    color: '#94a3b8',
  },
  fileButton: {
    borderRadius: 12,
    backgroundColor: '#fff',
    marginBottom: 6,
    shadowColor: '#d6deeb',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  fileButtonInner: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fileButtonText: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  fileHelperText: { fontSize: 11, color: '#64748b', marginBottom: 16 },
  primaryButton: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    marginTop: 12,
    shadowColor: '#2a4da8',
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryButtonInner: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  selectionBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'flex-end',
  },
  selectionCard: {
    maxHeight: '60%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
  },
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  selectionList: {
    maxHeight: 320,
  },
  selectionItem: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  selectionItemActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  selectionItemText: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '500',
  },
  selectionItemTextActive: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
});

export default ProfileScreen;
