import {apiClient} from "../../api/client";
export type AccessUser={id:string;email:string;displayName:string;accountStatus:string;membershipStatus:string;roleId:string;roleName:string;roleKey:string;lastLoginAt:string|null;joinedAt:string};
export type Role={id:string;key:string;name:string;description:string|null;isSystem:boolean;userCount:number;permissions:string[]};
export type Permission={key:string;module:string;name:string;description:string};
export const accessApi={
  users:async(search="")=>(await apiClient.get("/access/users",{params:{search}})).data.data as {items:AccessUser[];total:number},
  createUser:async(data:{email:string;displayName:string;initialPassword:string;roleId:string})=>(await apiClient.post("/access/users",data)).data.data,
  updateUser:async(id:string,data:Record<string,unknown>)=>{await apiClient.patch(`/access/users/${id}`,data);},
  roles:async()=>(await apiClient.get("/access/roles")).data.data as Role[],
  permissions:async()=>(await apiClient.get("/access/permissions")).data.data as Permission[],
  createRole:async(data:{name:string;description:string;permissionKeys:string[]})=>(await apiClient.post("/access/roles",data)).data.data,
  updateRole:async(id:string,data:Record<string,unknown>)=>{await apiClient.patch(`/access/roles/${id}`,data);}
};
