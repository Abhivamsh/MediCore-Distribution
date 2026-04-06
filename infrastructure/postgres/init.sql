-- MediCore Distribution – Database Initialization Script
-- Creates separate databases for each microservice

CREATE DATABASE medicore_auth;
CREATE DATABASE medicore_users;
CREATE DATABASE medicore_inventory;
CREATE DATABASE medicore_billing;
CREATE DATABASE medicore_purchase;
CREATE DATABASE medicore_analytics;

-- Grant all privileges to the medicore user
GRANT ALL PRIVILEGES ON DATABASE medicore_auth TO medicore;
GRANT ALL PRIVILEGES ON DATABASE medicore_users TO medicore;
GRANT ALL PRIVILEGES ON DATABASE medicore_inventory TO medicore;
GRANT ALL PRIVILEGES ON DATABASE medicore_billing TO medicore;
GRANT ALL PRIVILEGES ON DATABASE medicore_purchase TO medicore;
GRANT ALL PRIVILEGES ON DATABASE medicore_analytics TO medicore;
