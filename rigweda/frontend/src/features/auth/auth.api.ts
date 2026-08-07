import {apiClient} from "../../api/client";
import type {AuthUser} from "./types";
type AuthPayload={user:AuthUser;accessToken:string};
export const authApi={
  login:async(email:string,password:string)=>(await apiClient.post("/auth/login",{email,password})).data.data as AuthPayload,
  refresh:async()=>(await apiClient.post("/auth/refresh")).data.data as AuthPayload,
  me:async()=>(await apiClient.get("/auth/me")).data.data as AuthUser,
  logout:async()=>{await apiClient.post("/auth/logout");},
  changePassword:async(currentPassword:string,newPassword:string)=>{await apiClient.post("/auth/change-password",{currentPassword,newPassword});},
  forgotPassword:async(email:string)=>(await apiClient.post("/auth/forgot-password",{email})).data.data as {message:string;developmentResetToken?:string},
  resetPassword:async(token:string,newPassword:string)=>{await apiClient.post("/auth/reset-password",{token,newPassword});},
  sessions:async()=>(await apiClient.get("/auth/sessions")).data.data as Array<{id:string;userAgent:string;ipAddress:string;createdAt:string;lastUsedAt:string;expiresAt:string;current:boolean}>,
  revokeSession:async(id:string)=>{await apiClient.delete(`/auth/sessions/${id}`);},
  revokeOtherSessions:async()=>{await apiClient.delete("/auth/sessions");},
  preferences:async()=>(await apiClient.get("/auth/preferences")).data.data as {theme:null|{preset:string;appearance:string;customPrimary?:string;customAccent?:string};timezone:string|null;locale:string|null},
  updatePreferences:async(data:Record<string,unknown>)=>(await apiClient.patch("/auth/preferences",data)).data.data
};
