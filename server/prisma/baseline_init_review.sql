-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PATIENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" TEXT NOT NULL DEFAULT '',
    "assistantType" TEXT,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" TEXT NOT NULL DEFAULT 'ROLE_SELECTION',
    "operatingCity" TEXT DEFAULT 'Chengannur',
    "operatingRadiusKm" DOUBLE PRECISION DEFAULT 10.0,
    "vehicleType" TEXT,
    "maxActiveTasks" INTEGER NOT NULL DEFAULT 2,
    "professionTitle" TEXT,
    "registrationNumber" TEXT,
    "qualifications" TEXT,
    "serviceAreasApplied" TEXT,
    "issuingAuthority" TEXT,
    "yearsOfExperience" INTEGER,
    "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
    "declarationAcceptedAt" TIMESTAMP(3),
    "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "verificationNotes" TEXT,
    "rejectionReason" TEXT,
    "correctionReason" TEXT,
    "suspensionReason" TEXT,
    "approvedServices" TEXT,
    "reviewedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "workingDays" TEXT DEFAULT '["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"]',
    "workingHoursStart" TEXT DEFAULT '09:00',
    "workingHoursEnd" TEXT DEFAULT '17:00',
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "serviceFee" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "assistantProfileId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationReviewLog" (
    "id" TEXT NOT NULL,
    "assistantProfileId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "approvedServices" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pharmacy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "is24x7" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    "rating" DOUBLE PRECISION DEFAULT 0.0,
    "openingHours" TEXT NOT NULL DEFAULT '8:00 AM - 10:00 PM',
    "googleMapsUrl" TEXT,
    "emergencyAvailability" BOOLEAN NOT NULL DEFAULT false,
    "deliveryAvailable" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" TEXT NOT NULL DEFAULT 'PHARMACY_PROVIDED',
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pharmacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "dosageForm" TEXT NOT NULL,
    "strength" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "sideEffects" TEXT,
    "commonUses" TEXT,
    "alternativeGenerics" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "stock" INTEGER DEFAULT 0,
    "price" DOUBLE PRECISION DEFAULT 0.0,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "dataSource" TEXT NOT NULL DEFAULT 'PHARMACY_PROVIDED',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "ocrRawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "fileHash" TEXT,
    "screeningStatus" TEXT,
    "screeningResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedMedicine" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "matchedMedicineId" TEXT,
    "matchedMedicineName" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "needsMapping" BOOLEAN NOT NULL DEFAULT false,
    "evidenceSummary" TEXT,
    "extractedQuantity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderType" TEXT NOT NULL DEFAULT 'RESERVATION',
    "fulfillmentType" TEXT,
    "assistantServiceType" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "medicineSubtotal" DOUBLE PRECISION,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "platformFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "deliveryAddress" TEXT,
    "addressId" TEXT,
    "selectedAssistantId" TEXT,
    "prescriptionId" TEXT,
    "verificationPin" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "recipientName" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Chengannur',
    "state" TEXT NOT NULL DEFAULT 'Kerala',
    "postalCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" TEXT NOT NULL DEFAULT 'ONLINE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gateway" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewaySignature" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION,
    "subtotal" DOUBLE PRECISION,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantTask" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "assistantId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "serviceType" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveryAddress" TEXT,
    "serviceNote" TEXT,
    "deliveryNotes" TEXT,
    "handoverPin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "linkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "pharmacyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthcareAppointment" (
    "id" TEXT NOT NULL,
    "appointmentNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "scheduledDate" TEXT NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "serviceAddress" TEXT NOT NULL,
    "addressId" TEXT,
    "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "consentAccepted" BOOLEAN NOT NULL DEFAULT false,
    "consentAcceptedAt" TIMESTAMP(3),
    "consentVersion" TEXT DEFAULT 'v1.0',
    "prescriptionId" TEXT,
    "patientNotes" TEXT,
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthcareAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentStatusHistory" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantProfile_userId_key" ON "AssistantProfile"("userId");

-- CreateIndex
CREATE INDEX "VerificationDocument_assistantProfileId_idx" ON "VerificationDocument"("assistantProfileId");

-- CreateIndex
CREATE INDEX "VerificationReviewLog_assistantProfileId_idx" ON "VerificationReviewLog"("assistantProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_licenseNumber_key" ON "Pharmacy"("licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Pharmacy_managerId_key" ON "Pharmacy"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_pharmacyId_medicineId_key" ON "Inventory"("pharmacyId", "medicineId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantTask_orderId_key" ON "AssistantTask"("orderId");

-- CreateIndex
CREATE INDEX "RestockRequest_userId_idx" ON "RestockRequest"("userId");

-- CreateIndex
CREATE INDEX "RestockRequest_pharmacyId_medicineId_status_idx" ON "RestockRequest"("pharmacyId", "medicineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HealthcareAppointment_appointmentNumber_key" ON "HealthcareAppointment"("appointmentNumber");

-- CreateIndex
CREATE INDEX "HealthcareAppointment_patientId_idx" ON "HealthcareAppointment"("patientId");

-- CreateIndex
CREATE INDEX "HealthcareAppointment_professionalId_idx" ON "HealthcareAppointment"("professionalId");

-- CreateIndex
CREATE INDEX "HealthcareAppointment_scheduledDate_idx" ON "HealthcareAppointment"("scheduledDate");

-- CreateIndex
CREATE INDEX "HealthcareAppointment_status_idx" ON "HealthcareAppointment"("status");

-- CreateIndex
CREATE INDEX "AppointmentStatusHistory_appointmentId_idx" ON "AppointmentStatusHistory"("appointmentId");

-- AddForeignKey
ALTER TABLE "AssistantProfile" ADD CONSTRAINT "AssistantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_assistantProfileId_fkey" FOREIGN KEY ("assistantProfileId") REFERENCES "AssistantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReviewLog" ADD CONSTRAINT "VerificationReviewLog_assistantProfileId_fkey" FOREIGN KEY ("assistantProfileId") REFERENCES "AssistantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pharmacy" ADD CONSTRAINT "Pharmacy_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedMedicine" ADD CONSTRAINT "DetectedMedicine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "PatientAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAddress" ADD CONSTRAINT "PatientAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTask" ADD CONSTRAINT "AssistantTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTask" ADD CONSTRAINT "AssistantTask_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockRequest" ADD CONSTRAINT "RestockRequest_pharmacyId_fkey" FOREIGN KEY ("pharmacyId") REFERENCES "Pharmacy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareAppointment" ADD CONSTRAINT "HealthcareAppointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareAppointment" ADD CONSTRAINT "HealthcareAppointment_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareAppointment" ADD CONSTRAINT "HealthcareAppointment_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "PatientAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthcareAppointment" ADD CONSTRAINT "HealthcareAppointment_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentStatusHistory" ADD CONSTRAINT "AppointmentStatusHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "HealthcareAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

