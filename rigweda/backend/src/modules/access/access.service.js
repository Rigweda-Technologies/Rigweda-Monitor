const {AppError}=require("../../lib/app-error");
class AccessService{
  constructor(repository,passwords){this.repository=repository;this.passwords=passwords;}
  async listUsers(org,query){const result=await this.repository.listUsers(org,query);return{...result,page:query.page,pageSize:query.pageSize,totalPages:Math.ceil(result.total/query.pageSize)};}
  listRoles(org){return this.repository.listRoles(org);}listPermissions(){return this.repository.listPermissions();}
  async createUser(org,data){const result=await this.repository.createUser(org,data,await this.passwords.hash(data.initialPassword));if(result.error==="role")throw new AppError(422,"ROLE_INVALID","Selected role does not belong to this organization.");if(result.error==="membership")throw new AppError(409,"USER_ALREADY_MEMBER","This user already belongs to the organization.");return result;}
  async updateUser(org,id,data){const result=await this.repository.updateUser(org,id,data);if(result.error==="role")throw new AppError(422,"ROLE_INVALID","Selected role does not belong to this organization.");if(result.error==="user")throw new AppError(404,"USER_NOT_FOUND","User membership not found.");}
  async createRole(org,data){try{return await this.repository.createRole(org,data);}catch(error){if(error.code==="23505")throw new AppError(409,"ROLE_CONFLICT","A role with this name already exists.");if(error.code==="23503")throw new AppError(422,"PERMISSION_INVALID","One or more permissions are invalid.");throw error;}}
  async updateRole(org,id,data){const result=await this.repository.updateRole(org,id,data);if(result.error==="role")throw new AppError(404,"ROLE_NOT_FOUND","Role not found.");if(result.error==="protected")throw new AppError(422,"ROLE_PROTECTED","System Administrator permissions cannot be reduced.");}
}
module.exports={AccessService};
