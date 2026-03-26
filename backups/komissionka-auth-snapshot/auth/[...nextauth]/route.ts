import NextAuth from "next-auth";
import { authOptions } from "komiss/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
