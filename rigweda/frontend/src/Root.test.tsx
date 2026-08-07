import {render,screen} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {Root} from "./Root";
import {ThemeProvider} from "./theme/ThemeProvider";

const authState={user:null as null|{id:string},ready:false,login:vi.fn(),logout:vi.fn()};
vi.mock("./features/auth/AuthProvider",()=>({useAuth:()=>authState}));

describe("authentication gate",()=>{
  beforeEach(()=>{authState.user=null;authState.ready=false;});
  it("shows a session recovery state while booting",()=>{render(<ThemeProvider><Root/></ThemeProvider>);expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();});
  it("shows the secure login form when no session exists",()=>{authState.ready=true;render(<ThemeProvider><Root/></ThemeProvider>);expect(screen.getByRole("heading",{name:"Sign in to your workspace"})).toBeInTheDocument();expect(screen.getByLabelText("Email address")).toHaveValue("admin@rigweda.com");expect(screen.getByText(/Argon2id and rotating sessions/i)).toBeInTheDocument();});
});
