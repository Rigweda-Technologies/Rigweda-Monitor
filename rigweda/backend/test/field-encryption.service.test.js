const test=require("node:test");
const assert=require("node:assert/strict");
const {createFieldEncryption}=require("../src/modules/employees/field-encryption.service");

test("sensitive identifiers use authenticated encryption with random nonces",()=>{
  const encryption=createFieldEncryption("a-dedicated-test-key-with-more-than-32-characters");
  const first=encryption.protect("ABCDE1234F");const second=encryption.protect("ABCDE1234F");
  assert.notDeepEqual(first.iv,second.iv);
  assert.notDeepEqual(first.ciphertext,second.ciphertext);
  assert.equal(first.maskedValue,"••••••234F");
  assert.equal(first.ciphertext.includes(Buffer.from("ABCDE1234F")),false);
});
