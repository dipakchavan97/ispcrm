FROM nginx:alpine

# Create directory structure for certbot challenges and certificates
RUN mkdir -p /var/www/certbot /etc/ssl/certs/app /var/log/nginx

# Copy default hardened nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
