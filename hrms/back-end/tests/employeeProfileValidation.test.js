const test = require("node:test");
const assert = require("node:assert/strict");

const {
  completeProfileSchema,
  updateEmployeeSchema
} = require("../src/modules/employees/employee.validation");

const validCompleteProfilePayload = {
  phone: "9876543210",
  dob: "1998-01-20",
  gender: "Male",
  aadhaarNumber: "123456789012",
  panNumber: "ABCDE1234F",
  address: {
    line1: "Street 1",
    city: "Hyderabad",
    state: "Telangana",
    country: "India",
    zip: "500081"
  }
};

test("completeProfileSchema accepts numeric zip", () => {
  const { error } = completeProfileSchema.validate(validCompleteProfilePayload);
  assert.equal(error, undefined);
});

test("completeProfileSchema accepts empty address line 2", () => {
  const { error } = completeProfileSchema.validate({
    ...validCompleteProfilePayload,
    address: {
      ...validCompleteProfilePayload.address,
      line2: ""
    }
  });
  assert.equal(error, undefined);
});

test("completeProfileSchema rejects alphabetic zip", () => {
  const { error } = completeProfileSchema.validate({
    ...validCompleteProfilePayload,
    address: {
      ...validCompleteProfilePayload.address,
      zip: "ABC123"
    }
  });
  assert.ok(error);
});

test("updateEmployeeSchema rejects alphabetic zip", () => {
  const { error } = updateEmployeeSchema.validate({
    address: {
      zip: "ABCDE"
    }
  });
  assert.ok(error);
});

test("updateEmployeeSchema accepts empty address line 2", () => {
  const { error } = updateEmployeeSchema.validate({
    address: {
      line2: ""
    }
  });
  assert.equal(error, undefined);
});

test("updateEmployeeSchema accepts profile image upload payload", () => {
  const { error } = updateEmployeeSchema.validate({
    profileImageUpload: {
      fileName: "avatar.png",
      mimeType: "image/png",
      base64Data: "ZmFrZS1pbWFnZS1ieXRlcw=="
    }
  });
  assert.equal(error, undefined);
});

test("updateEmployeeSchema accepts empty optional personal fields", () => {
  const { error } = updateEmployeeSchema.validate({
    dob: "",
    gender: "",
    bloodGroup: "",
    aadhaarNumber: "",
    panNumber: ""
  });
  assert.equal(error, undefined);
});
