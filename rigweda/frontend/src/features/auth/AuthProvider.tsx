import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from "react";
import {apiClient} from "../../api/client";
import {authApi} from "./auth.api";
import type {AuthUser} from "./types";

type AuthContextValue={user:AuthUser|null;ready:boolean;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;hasPermission:(permission:string)=>boolean};
const AuthContext=createContext<AuthContextValue|null>(null);
const setToken=(token:string|null)=>{if(token)apiClient.defaults.headers.common.Authorization=`Bearer ${token}`;else delete apiClient.defaults.headers.common.Authorization;};
let recoveryPromise:ReturnType<typeof authApi.refresh>|null=null;
const recoverSession=()=>{
  if(!recoveryPromise){const current=authApi.refresh();recoveryPromise=current;current.finally(()=>{if(recoveryPromise===current)recoveryPromise=null;}).catch(()=>{});}
  return recoveryPromise!;
};

export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<AuthUser|null>(null);const [ready,setReady]=useState(false);
  useEffect(()=>{let active=true;recoverSession().then(data=>{if(active){setToken(data.accessToken);setUser(data.user);}}).catch(()=>{if(active){setToken(null);setUser(null);}}).finally(()=>active&&setReady(true));return()=>{active=false;};},[]);
  const login=async(email:string,password:string)=>{const data=await authApi.login(email,password);setToken(data.accessToken);setUser(data.user);};
  const logout=async()=>{try{await authApi.logout();}finally{setToken(null);setUser(null);}};
  const hasPermission=(permission:string)=>!!user?.permissions?.includes(permission);
  const value=useMemo(()=>({user,ready,login,logout,hasPermission}),[user,ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error("useAuth must be used inside AuthProvider");return value;}
