import bcrypt from "bcrypt";

const hash = "$2a$10$vz6FZQ6Gv9cLx.avjBZbsu0WtF9CInKayfE/hynRE2SVBQD2B8REy";
const passwordToTest = "your-suspected-password";

console.log(await bcrypt.compare(passwordToTest, hash));