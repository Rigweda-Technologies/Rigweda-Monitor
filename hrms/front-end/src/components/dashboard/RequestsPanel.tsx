import { motion } from "framer-motion";
import { 
  UserCircle, 
  Briefcase, 
  Palmtree, 
  Stethoscope, 
  MoreHorizontal,
  ChevronRight
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const requests = [
  { 
    icon: <UserCircle className="w-5 h-5" />, 
    label: "Profile Update", 
    count: 5,
    color: "bg-blue-100 text-blue-700"
  },
  { 
    icon: <Briefcase className="w-5 h-5" />, 
    label: "Business Trip", 
    count: 3,
    color: "bg-purple-100 text-purple-700"
  },
  { 
    icon: <Palmtree className="w-5 h-5" />, 
    label: "Vacation", 
    count: 8,
    color: "bg-green-100 text-green-700"
  },
  { 
    icon: <Stethoscope className="w-5 h-5" />, 
    label: "Sick Leave", 
    count: 2,
    color: "bg-red-100 text-red-700"
  },
  { 
    icon: <MoreHorizontal className="w-5 h-5" />, 
    label: "Other", 
    count: 4,
    color: "bg-gray-100 text-gray-700"
  },
];

export const RequestsPanel = () => {
  return (
    <motion.div
      className="stat-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Pending Requests</h3>
        <a href="/requests" className="link-primary text-sm">View All</a>
      </div>

      <div className="space-y-3">
        {requests.map((request, index) => (
          <motion.div
            key={request.label}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.8 + index * 0.1 }}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${request.color}`}>
                {request.icon}
              </div>
              <span className="font-medium text-foreground">{request.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-semibold">
                {request.count}
              </Badge>
              <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          Total pending: <span className="font-semibold text-foreground">22</span> requests
        </p>
      </div>
    </motion.div>
  );
};
