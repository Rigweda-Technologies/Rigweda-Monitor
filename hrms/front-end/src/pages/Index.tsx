import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import { 
  TrendingUp, Users, LayoutDashboard, Calendar, 
  DollarSign, UserPlus, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const quickActions = [
  {
    title: "View Dashboard",
    description: "See your HR analytics and metrics",
    icon: <LayoutDashboard className="w-6 h-6" />,
    href: "/dashboard",
    color: "bg-blue-100 text-blue-700",
  },
  {
    title: "Manage Employees",
    description: "View and manage your team",
    icon: <Users className="w-6 h-6" />,
    href: "/employees",
    color: "bg-green-100 text-green-700",
  },
  {
    title: "Attendance",
    description: "Track employee attendance",
    icon: <Calendar className="w-6 h-6" />,
    href: "/attendance",
    color: "bg-purple-100 text-purple-700",
  },
  {
    title: "Leave Management",
    description: "Handle leave requests",
    icon: <TrendingUp className="w-6 h-6" />,
    href: "/leave",
    color: "bg-orange-100 text-orange-700",
  },
  {
    title: "Payroll",
    description: "Process salaries and payments",
    icon: <DollarSign className="w-6 h-6" />,
    href: "/payroll",
    color: "bg-emerald-100 text-emerald-700",
  },
  {
    title: "Add Employee",
    description: "Onboard a new team member",
    icon: <UserPlus className="w-6 h-6" />,
    href: "/employees/add",
    color: "bg-pink-100 text-pink-700",
  },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto">
        {/* Welcome Section */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Welcome to HRMS
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Your complete human resource management solution. Manage employees, 
            track attendance, process payroll, and more - all in one place.
          </p>
        </motion.div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.title}
              className="stat-card cursor-pointer group"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.1 }}
              onClick={() => navigate(action.href)}
            >
              <div className={`w-12 h-12 rounded-xl ${action.color} flex items-center justify-center mb-4`}>
                {action.icon}
              </div>
              <h3 className="font-semibold text-foreground mb-1 group-hover:text-primary transition-colors">
                {action.title}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {action.description}
              </p>
              <div className="flex items-center text-primary text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Open <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA Section */}
        <motion.div
          className="stat-card text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Ready to get started?
          </h2>
          <p className="text-muted-foreground mb-4">
            Head to the dashboard to see your HR metrics and insights.
          </p>
          <Button size="lg" onClick={() => navigate("/dashboard")}>
            Go to Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </motion.div>
      </div>
    </MainLayout>
  );
};

export default Index;
