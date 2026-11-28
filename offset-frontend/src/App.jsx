import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import PlanOrders from "./pages/PlanOrders";
import JobPlans from "./pages/JobPlans";
import MainSheet from "./pages/MainSheet";
import AppLayout from "./Components/AppLayout";
import ProtectedRoute from "./Components/ProtectedRoute"; // capital C, matches the folder name
import Home from "./pages/Home";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Home />} />
        <Route path="plan" element={<PlanOrders />} />
        <Route path="job-plans" element={<JobPlans />} />
        <Route path="references" element={<MainSheet />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
