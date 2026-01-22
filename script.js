// --- 1. SUPABASE TƏNZİMLƏMƏLƏRİ ---
const SUPABASE_URL = "https://cxpddxwknchgbirbvvly.supabase.co";
const SUPABASE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4cGRkeHdrbmNoZ2JpcmJ2dmx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwOTY0NTQsImV4cCI6MjA4NDY3MjQ1NH0.12CQncOlgcBn1XeRSsrGKoN59xU_5dU-jG-NOCjo-rg";
let supabaseClient = null;

// Xəritə Dəyişənləri
let map = null;
let routingControl = null;
let pickupMarker = null;
let dropoffMarker = null;

const app = {
    currentUser: null,
    currentRole: null,
    orders: [],

    // --- SİSTEMİN BAŞLAMASI ---
    init: async () => {
        console.log("Sistem başladılır...");
        try {
            if (!SUPABASE_URL.startsWith("http") || SUPABASE_KEY.includes("BURA"))
                throw new Error("Açarları düzəldin!");
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        } catch (err) {
            return app.showToast(err.message, "error");
        }

        const {
            data: { session },
        } = await supabaseClient.auth.getSession();
        if (session) await app.handleLoginSuccess(session.user.id, false);
        else app.showScreen("screen-login");

        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
                app.showScreen("screen-login");
                app.currentUser = null;
            }
        });

        // REALTIME İZLƏMƏ
        supabaseClient
            .channel("public:orders")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "orders" },
                (payload) => {
                    app.fetchOrders();
                    app.showToast("Məlumatlar yeniləndi 🔔", "info");

                    if (payload.eventType === "INSERT" && app.currentRole === "courier") {
                        if (
                            document.getElementById("onlineToggle") &&
                            document.getElementById("onlineToggle").checked
                        ) {
                            app.playAlert();
                            app.sendBrowserNotification("Yeni Sifariş!", "Xəritədə baxın!");
                        }
                    }
                }
            )
            .subscribe();
    },

    // --- NAVİQASİYA ---
    showScreen: (id) => {
        document.querySelectorAll(".screen").forEach((e) => {
            e.classList.remove("active");
            e.classList.add("hidden");
        });
        const t = document.getElementById(id);
        if (t) {
            t.classList.remove("hidden");
            setTimeout(() => t.classList.add("active"), 10);
        }
        if (id === "screen-seller") {
            setTimeout(() => {
                if (!map) app.initMap();
                else map.invalidateSize();
            }, 400);
        }
    },
    toggleSidebar: () => {
        document.getElementById("sidebar").classList.toggle("active");
        document.getElementById("overlay").classList.toggle("active");
    },
    goHome: () => {
        app.toggleSidebar();
        app.showScreen(
            app.currentRole === "seller" ? "screen-seller" : "screen-courier"
        );
    },
    switchAuth: (t) => {
        document
            .querySelectorAll(".btn-tab")
            .forEach((b) => b.classList.remove("active"));
        document.getElementById(`tab-${t}`).classList.add("active");
        document.getElementById("form-login").className =
            t === "login" ? "" : "hidden";
        document.getElementById("form-register").className =
            t === "register" ? "" : "hidden";
    },
    toggleRegFields: () => {
        const r = document.querySelector('input[name="role"]:checked').value;
        document.getElementById("seller-fields").className =
            r === "seller" ? "" : "hidden";
        document.getElementById("courier-fields").className =
            r === "courier" ? "" : "hidden";
    },

    // --- XƏRİTƏ & GEOCODING ---
    initMap: () => {
        if (map) return;
        map = L.map("map").setView([40.4093, 49.8671], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap",
        }).addTo(map);
        map.on("click", function (e) {
            app.handleMapClick(e.latlng);
        });
    },

    handleMapClick: (latlng) => {
        if (!pickupMarker) {
            pickupMarker = L.marker(latlng, { draggable: true })
                .addTo(map)
                .bindPopup("Götürüləcək")
                .openPopup();
            document.getElementById("p_lat").value = latlng.lat;
            document.getElementById("p_lng").value = latlng.lng;
            app.getAddressFromCoords(latlng.lat, latlng.lng, "pickup");
        } else if (!dropoffMarker) {
            dropoffMarker = L.marker(latlng, { draggable: true })
                .addTo(map)
                .bindPopup("Çatdırılacaq")
                .openPopup();
            document.getElementById("d_lat").value = latlng.lat;
            document.getElementById("d_lng").value = latlng.lng;
            app.getAddressFromCoords(latlng.lat, latlng.lng, "dropoff");
            app.calculateRoute(pickupMarker.getLatLng(), dropoffMarker.getLatLng());
        } else {
            app.resetMap();
            app.handleMapClick(latlng);
        }
    },

    manualAddressInput: async (type) => {
        const address = document.getElementById(type).value;
        if (address.length < 3) return;
        app.showToast("Ünvan axtarılır...", "info");
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${address}, Baku, Azerbaijan`
            );
            const data = await res.json();
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                const latlng = { lat, lng };

                if (type === "pickup") {
                    if (pickupMarker) map.removeLayer(pickupMarker);
                    pickupMarker = L.marker(latlng, { draggable: true })
                        .addTo(map)
                        .bindPopup("Götür: " + address)
                        .openPopup();
                    document.getElementById("p_lat").value = lat;
                    document.getElementById("p_lng").value = lng;
                } else {
                    if (dropoffMarker) map.removeLayer(dropoffMarker);
                    dropoffMarker = L.marker(latlng, { draggable: true })
                        .addTo(map)
                        .bindPopup("Çatdır: " + address)
                        .openPopup();
                    document.getElementById("d_lat").value = lat;
                    document.getElementById("d_lng").value = lng;
                }
                map.setView(latlng, 13);
                if (pickupMarker && dropoffMarker)
                    app.calculateRoute(
                        pickupMarker.getLatLng(),
                        dropoffMarker.getLatLng()
                    );
            } else app.showToast("Ünvan tapılmadı", "error");
        } catch (e) {
            console.error(e);
        }
    },

    calculateRoute: (start, end) => {
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [L.latLng(start.lat, start.lng), L.latLng(end.lat, end.lng)],
            routeWhileDragging: false,
            addWaypoints: false,
            show: false,
            createMarker: () => null,
        })
            .on("routesfound", function (e) {
                const km = (e.routes[0].summary.totalDistance / 1000).toFixed(1);
                document.getElementById("distanceDisplay").value = km + " km";
                let calcPrice = Math.max(2, km * 0.7).toFixed(1);
                document.getElementById("price").value = calcPrice;
            })
            .addTo(map);
    },

    getAddressFromCoords: async (lat, lng, fieldId) => {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
            );
            const data = await res.json();
            if (data && data.display_name) {
                document.getElementById(fieldId).value = data.display_name
                    .split(",")
                    .slice(0, 3)
                    .join(",");
            }
        } catch (e) { }
    },

    resetMap: () => {
        if (pickupMarker) map.removeLayer(pickupMarker);
        if (dropoffMarker) map.removeLayer(dropoffMarker);
        if (routingControl) map.removeControl(routingControl);
        pickupMarker = null;
        dropoffMarker = null;
        routingControl = null;
        document.getElementById("distanceDisplay").value = "";
        document.getElementById("price").value = "";
    },

    // --- SİFARİŞ YARATMAQ (SATICI) ---
    createOrder: async () => {
        const item = document.getElementById("itemName").value;
        const pickup = document.getElementById("pickup").value;
        const dropoff = document.getElementById("dropoff").value;
        const rName = document.getElementById("recipientName").value;
        const rPhone = document.getElementById("recipientPhone").value;
        const price = document.getElementById("price").value;
        const pLat = document.getElementById("p_lat").value || 0;
        const pLng = document.getElementById("p_lng").value || 0;
        const dLat = document.getElementById("d_lat").value || 0;
        const dLng = document.getElementById("d_lng").value || 0;

        if (!item || !pickup || !dropoff || !rPhone || !price)
            return app.showToast("Bütün xanaları doldurun!", "error");

        const { error } = await supabaseClient.from("orders").insert({
            seller_id: app.currentUser.id,
            item_name: item,
            pickup_address: pickup,
            dropoff_address: dropoff,
            recipient_name: rName,
            recipient_phone: rPhone,
            price: parseFloat(price),
            is_fragile: document.getElementById("isFragile").checked,
            status: "pending",
            pickup_lat: parseFloat(pLat),
            pickup_lng: parseFloat(pLng),
            dropoff_lat: parseFloat(dLat),
            dropoff_lng: parseFloat(dLng),
        });

        if (error) app.showToast(error.message, "error");
        else {
            app.showToast("Sifariş yaradıldı!", "success");
            app.fetchOrders();
            app.resetMap();
            document.getElementById("itemName").value = "";
            document.getElementById("pickup").value = "";
            document.getElementById("dropoff").value = "";
            document.getElementById("recipientName").value = "";
            document.getElementById("recipientPhone").value = "";
            document.getElementById("price").value = "";
        }
    },

    // --- SİFARİŞLƏRİ GƏTİRMƏK ---
    fetchOrders: async () => {
        if (!supabaseClient) return;

        // JOIN: Həm satıcı, həm kuryer məlumatlarını çəkirik
        const { data, error } = await supabaseClient
            .from("orders")
            .select(
                `*, profiles:seller_id (full_name, shop_name, phone), courier_profile:courier_id (full_name, phone, vehicle_plate)`
            )
            .order("created_at", { ascending: false });

        if (error) return console.error(error);
        app.orders = data;

        if (app.currentRole === "seller") {
            app.renderSellerOrders();
            app.renderSellerRequests();
        } else {
            if (!document.getElementById("onlineToggle").checked) {
                document.getElementById("courier-market-list").innerHTML =
                    '<p class="empty-msg">Sifarişləri görmək üçün <b>Online</b> olun.</p>';
            } else {
                app.renderCourierMarket(data.filter((o) => o.status === "pending"));
            }
            const myJobs = data.filter(
                (o) =>
                    o.courier_id === app.currentUser.id &&
                    (o.status === "assigned" ||
                        o.status === "waiting_approval" ||
                        o.status === "picked_up")
            );
            app.renderCourierActiveJobs(myJobs);
        }
    },

    // --- SATICI UI ---
    renderSellerOrders: () => {
        const list = document.getElementById("seller-orders-list");
        list.innerHTML = "";

        app.orders
            .filter(
                (o) =>
                    o.seller_id === app.currentUser.id && o.status !== "waiting_approval"
            )
            .forEach((o) => {
                let statusBadge = "";
                let extraInfo = "";

                if (o.status === "pending") {
                    statusBadge =
                        '<span style="color:#f59e0b">⏳ Kuryer axtarılır...</span>';
                } else if (o.status === "assigned") {
                    statusBadge =
                        '<span style="color:#3b82f6">🏃 Kuryer Mağazaya Gəlir</span>';
                    extraInfo = `<div style="font-size:0.8rem; background:#eff6ff; padding:5px; border-radius:6px; margin-top:5px;">Kuryer gələndə məhsulu təhvil verin.</div>`;
                } else if (o.status === "picked_up") {
                    statusBadge =
                        '<span style="color:#8b5cf6">🏍️ Kuryer Müştəriyə Gedir</span>';
                    extraInfo = `<div style="font-size:0.8rem; background:#f3e8ff; padding:5px; border-radius:6px; margin-top:5px;">Mal kuryerdədir.</div>`;
                } else if (o.status === "delivered") {
                    statusBadge = '<span style="color:#10b981">✅ Çatdırıldı</span>';
                }

                list.innerHTML += `
            <div class="order-card">
                <div class="order-header"><span>${o.item_name}</span> <span class="price-tag">${o.price} AZN</span></div>
                <div class="route-info">🏁 ${o.dropoff_address}</div>
                <div style="font-size:0.9rem; margin-top:5px; font-weight:600;">${statusBadge}</div>
                ${extraInfo}
            </div>`;
            });
    },

    renderSellerRequests: () => {
        const container = document.getElementById("seller-requests-container");
        const list = document.getElementById("seller-requests-list");
        const requests = app.orders.filter(
            (o) =>
                o.status === "waiting_approval" && o.seller_id === app.currentUser.id
        );

        if (requests.length > 0) {
            container.classList.remove("hidden");
            list.innerHTML = "";
            requests.forEach((o) => {
                const cName = o.courier_profile
                    ? o.courier_profile.full_name
                    : "Kuryer";
                const cPlate =
                    o.courier_profile && o.courier_profile.vehicle_plate
                        ? o.courier_profile.vehicle_plate
                        : "Nömrə yoxdur";
                list.innerHTML += `
                    <div class="card" style="background:white; border-left:4px solid #f59e0b;">
                        <p><b>${o.item_name}</b> üçün təklif var!</p>
                        <div style="background:#fff7ed; padding:10px; border-radius:8px; margin:10px 0;">
                            👤 <b>${cName}</b> (${cPlate})<br>⏱️ Gəlmə vaxtı: <b style="color:#c2410c;">${o.courier_eta || "?"
                    }</b>
                        </div>
                        <div class="row">
                            <button onclick="app.approveCourier(${o.id
                    })" class="btn btn-success" style="font-size:0.9rem;">✅ Təsdiqlə</button>
                            <button onclick="app.rejectCourier(${o.id
                    })" class="btn btn-logout" style="font-size:0.9rem; margin-top:0;">❌ Rədd et</button>
                        </div>
                    </div>`;
            });
        } else {
            container.classList.add("hidden");
        }
    },

    // --- KURYER UI (ZƏNG VƏ MAĞAZA ADI) ---
    applyForOrder: async (orderId, pickupLat, pickupLng) => {
        if (!navigator.geolocation) return app.showToast("GPS lazımdır!", "error");
        app.showToast("Məsafə hesablanır...", "info");

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const curLat = pos.coords.latitude;
                const curLng = pos.coords.longitude;
                try {
                    const response = await fetch(
                        `https://router.project-osrm.org/route/v1/driving/${curLng},${curLat};${pickupLng},${pickupLat}?overview=false`
                    );
                    const data = await response.json();

                    if (data.routes && data.routes.length > 0) {
                        const mins = Math.ceil(data.routes[0].duration / 60);
                        const etaText = `${mins} dəq`;
                        const { error } = await supabaseClient
                            .from("orders")
                            .update({
                                status: "waiting_approval",
                                courier_id: app.currentUser.id,
                                courier_eta: etaText,
                            })
                            .eq("id", orderId);

                        if (error) app.showToast(error.message, "error");
                        else app.showToast(`Təklif göndərildi!`, "success");
                    } else app.showToast("Məsafə xətası", "error");
                } catch (e) {
                    app.showToast("Naviqasiya xətası", "error");
                }
            },
            () => app.showToast("GPS icazəsi verin!", "error")
        );
    },

    renderCourierMarket: (orders) => {
        const list = document.getElementById("courier-market-list");
        list.innerHTML = "";
        if (orders.length === 0) {
            list.innerHTML = '<p class="empty-msg">Sifariş yoxdur</p>';
            return;
        }

        orders.forEach((o) => {
            // YENİ: Mağaza adını "Pending" olanda da göstər
            const shop =
                o.profiles && o.profiles.shop_name ? o.profiles.shop_name : "Mağaza";
            list.innerHTML += `
                <div class="order-card">
                    <div class="order-header"><span>${o.item_name}</span> <span class="price-tag">${o.price} AZN</span></div>
                    <div class="route-info">🏪 <b>${shop}</b> (${o.pickup_address})<br>🏁 <b>Hara:</b> ${o.dropoff_address}</div>
                    <button onclick="app.applyForOrder(${o.id}, ${o.pickup_lat}, ${o.pickup_lng})" class="btn btn-primary" style="margin-top:10px">🙋‍♂️ Təklif Göndər</button>
                </div>`;
        });
    },

    renderCourierActiveJobs: (jobs) => {
        const container = document.getElementById("courier-active-job");
        container.innerHTML = "";
        if (jobs.length === 0) {
            container.innerHTML = '<p class="empty-msg">Aktiv iş yoxdur</p>';
            return;
        }

        jobs.forEach((o) => {
            if (o.status === "waiting_approval") {
                container.innerHTML += `<div class="card" style="border:2px dashed #f59e0b; background:#fffbeb; opacity:0.9;"><h3>⏳ Təsdiq Gözləyir...</h3><p>📦 ${o.item_name}</p><p>Verilən vaxt: <b>${o.courier_eta}</b></p><p style="font-size:0.8rem;color:#666;">Mağaza təsdiqləyən kimi iş başlayacaq.</p></div>`;
                return;
            }

            const shop =
                o.profiles && o.profiles.shop_name ? o.profiles.shop_name : "Satıcı";
            const shopPhone = o.profiles && o.profiles.phone ? o.profiles.phone : "";
            let actionArea = "";
            let statusText = "";

            // 1. Mağazaya Gedir (ZƏNG DÜYMƏSİ ƏLAVƏ EDİLDİ)
            if (o.status === "assigned") {
                statusText = "🏃 <b>Mağazaya sürün!</b>";
                const waze = `https://waze.com/ul?ll=${o.pickup_lat},${o.pickup_lng}&navigate=yes`;
                const maps = `https://www.google.com/maps/dir/?api=1&destination=${o.pickup_lat},${o.pickup_lng}`;

                actionArea = `
                    <div style="background:#eff6ff; padding:10px; border-radius:8px; margin-bottom:10px;">
                        <p>🏪 <b>Mağaza:</b> ${shop}</p>
                        <p>📞 <a href="tel:${shopPhone}" style="color:var(--primary); font-weight:bold; text-decoration:none;">${shopPhone} (Zəng Et)</a></p>
                        <p>📍 ${o.pickup_address}</p>
                        <div style="display:flex;gap:10px;margin-top:10px;">
                            <a href="${waze}" target="_blank" class="btn btn-secondary" style="flex:1;">Waze</a>
                            <a href="${maps}" target="_blank" class="btn btn-secondary" style="flex:1;">Maps</a>
                        </div>
                    </div>
                    <button onclick="app.pickupOrder(${o.id})" class="btn btn-primary" style="background:#3b82f6;">📦 Məhsulu Götürdüm</button>
                `;
            }
            // 2. Müştəriyə Gedir (ZƏNG DÜYMƏSİ ƏLAVƏ EDİLDİ)
            else if (o.status === "picked_up") {
                statusText = "🏍️ <b>Müştəriyə sürün!</b>";
                const waze = `https://waze.com/ul?ll=${o.dropoff_lat},${o.dropoff_lng}&navigate=yes`;
                const maps = `https://www.google.com/maps/dir/?api=1&destination=${o.dropoff_lat},${o.dropoff_lng}`;

                actionArea = `
                    <div style="background:#f3e8ff; padding:10px; border-radius:8px; margin-bottom:10px;">
                        <p>👤 <b>Alıcı:</b> ${o.recipient_name}</p>
                        <p>📞 <a href="tel:${o.recipient_phone}" style="color:var(--secondary); font-weight:bold; text-decoration:none;">${o.recipient_phone} (Zəng Et)</a></p>
                        <p>🏁 ${o.dropoff_address}</p>
                        <div style="display:flex;gap:10px;margin-top:10px;">
                            <a href="${waze}" target="_blank" class="btn btn-secondary" style="flex:1;">Waze</a>
                            <a href="${maps}" target="_blank" class="btn btn-secondary" style="flex:1;">Maps</a>
                        </div>
                    </div>
                    <button onclick="app.completeOrder(${o.id})" class="btn btn-success">✅ Təhvil Verdim</button>
                `;
            }

            container.innerHTML += `
            <div class="card" style="border:2px solid var(--primary); background:white;">
                <div class="order-header"><span>📦 ${o.item_name}</span> <span class="price-tag">${o.price} AZN</span></div>
                <div style="margin-bottom:10px;">${statusText}</div>
                ${actionArea}
            </div>`;
        });
    },

    // --- ORDER ACTIONS ---
    approveCourier: async (id) => {
        const { error } = await supabaseClient
            .from("orders")
            .update({ status: "assigned", accepted_at: new Date().toISOString() })
            .eq("id", id);
        if (error) app.showToast(error.message, "error");
        else {
            app.showToast("Kuryer təsdiqləndi! ✅", "success");
            app.fetchOrders();
        }
    },
    rejectCourier: async (id) => {
        const { error } = await supabaseClient
            .from("orders")
            .update({ status: "pending", courier_id: null, courier_eta: null })
            .eq("id", id);
        if (error) app.showToast(error.message, "error");
        else {
            app.showToast("Rədd edildi ❌", "info");
            app.fetchOrders();
        }
    },
    pickupOrder: async (id) => {
        const { error } = await supabaseClient
            .from("orders")
            .update({ status: "picked_up", picked_up_at: new Date().toISOString() })
            .eq("id", id);
        if (error) app.showToast(error.message, "error");
        else app.showToast("Məhsul götürüldü! Müştəriyə sürün.", "success");
    },
    completeOrder: async (id) => {
        const { error } = await supabaseClient
            .from("orders")
            .update({ status: "delivered", delivered_at: new Date().toISOString() })
            .eq("id", id);
        if (error) app.showToast("Xəta", "error");
        else app.showToast("Təbriklər! Pulunuzu alın.", "success");
    },

    // --- AUTH & PROFILE ---
    signUp: async () => {
        const email = document.getElementById("reg-email").value;
        const password = document.getElementById("reg-password").value;
        const name = document.getElementById("reg-name").value;
        const phone = document.getElementById("reg-phone").value;
        const role = document.querySelector('input[name="role"]:checked').value;
        if (!email || !password || !name || !phone)
            return app.showToast("Boş xanaları doldurun!", "error");

        const { data: existing } = await supabaseClient
            .from("profiles")
            .select("id")
            .eq("phone", phone)
            .single();
        if (existing) return app.showToast("Bu nömrə artıq var!", "error");

        let extraData = { full_name: name, role, phone };
        if (role === "courier") {
            const plate = document.getElementById("reg-plate").value,
                fileInput = document.getElementById("reg-file");
            if (!plate || fileInput.files.length === 0)
                return app.showToast("Sənəd/Nömrə vacibdir!", "error");
            const file = fileInput.files[0],
                fileName = `ids/${Date.now()}_${file.name}`;
            await supabaseClient.storage.from("documents").upload(fileName, file);
            const {
                data: { publicUrl },
            } = supabaseClient.storage.from("documents").getPublicUrl(fileName);
            extraData.vehicle_plate = plate;
            extraData.id_image_url = publicUrl;
            extraData.vehicle_type = document.getElementById("reg-vehicle").value;
        } else {
            extraData.shop_name = document.getElementById("reg-shop-name").value;
            extraData.shop_address =
                document.getElementById("reg-shop-address").value;
        }

        const { error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: extraData },
        });
        if (error) app.showToast(error.message, "error");
        else {
            app.showToast("Uğurlu! Giriş edin.", "success");
            app.switchAuth("login");
        }
    },
    signIn: async () => {
        const email = document.getElementById("login-email").value,
            password = document.getElementById("login-password").value;
        app.showToast("Giriş...", "info");
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password,
        });
        if (error) app.showToast("Səhvdir", "error");
        else await app.handleLoginSuccess(data.user.id, true);
    },
    handleLoginSuccess: async (userId, welcome = true) => {
        const { data: p } = await supabaseClient
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();
        if (!p) return;
        app.currentUser = p;
        app.currentRole = p.role;
        document.getElementById("sidebar-username").innerText = p.full_name;
        document.getElementById("sidebar-role").innerText =
            p.role === "seller"
                ? `Satıcı (${p.shop_name || ""})`
                : `Kuryer (${p.vehicle_plate || ""})`;
        const tog = document.getElementById("onlineToggle");
        if (tog) tog.checked = p.is_online;
        if (welcome) app.showToast(`Xoş gəldin, ${p.full_name}`, "success");
        app.showScreen(p.role === "seller" ? "screen-seller" : "screen-courier");
        app.fetchOrders();
    },
    logout: async () => {
        await supabaseClient.auth.signOut();
        window.location.reload();
    },

    // --- HISTORY, SETTINGS, UTILS ---
    openHistory: async () => {
        app.toggleSidebar();
        app.showScreen("screen-history");
        const list = document.getElementById("history-list");
        document.getElementById("history-stats-title").innerText =
            app.currentRole === "seller" ? "Cəmi Xərclənən" : "Cəmi Qazanc";
        list.innerHTML = '<p class="empty-msg">Yüklənir...</p>';

        // YENİ: History Detalları
        let q = supabaseClient
            .from("orders")
            .select(
                `*, profiles:seller_id (shop_name, phone), courier_profile:courier_id (full_name, phone, vehicle_plate)`
            )
            .eq("status", "delivered")
            .order("created_at", { ascending: false });
        if (app.currentRole === "seller") q = q.eq("seller_id", app.currentUser.id);
        else q = q.eq("courier_id", app.currentUser.id);

        const { data, error } = await q;
        if (error || !data || data.length === 0) {
            list.innerHTML = '<p class="empty-msg">Boşdur.</p>';
            document.getElementById("history-total-amount").innerText = "0.00 ₼";
            return;
        }

        document.getElementById("history-total-amount").innerText =
            data.reduce((s, o) => s + Number(o.price), 0).toFixed(2) + " ₼";
        list.innerHTML = "";
        data.forEach((o) => {
            const date = new Date(o.created_at).toLocaleDateString("az-AZ", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
            });

            let details = "";
            if (app.currentRole === "seller") {
                const cName = o.courier_profile
                    ? o.courier_profile.full_name
                    : "Kuryer";
                const cPlate =
                    o.courier_profile && o.courier_profile.vehicle_plate
                        ? o.courier_profile.vehicle_plate
                        : "";
                const cPhone = o.courier_profile ? o.courier_profile.phone : "";

                details = `
                <div style="font-size:0.85rem; margin-top:5px;">
                    <p>🏁 <b>Hara:</b> ${o.dropoff_address}</p>
                    <p>🛵 <b>Çatdırdı:</b> ${cName} (${cPlate})</p>
                    <p>📞 Kuryer: <a href="tel:${cPhone}">${cPhone}</a></p>
                    <p>👤 Alıcı: ${o.recipient_name} (<a href="tel:${o.recipient_phone}">${o.recipient_phone}</a>)</p>
                </div>`;
            } else {
                const sName =
                    o.profiles && o.profiles.shop_name ? o.profiles.shop_name : "Mağaza";
                const sPhone = o.profiles && o.profiles.phone ? o.profiles.phone : "";

                details = `
                <div style="font-size:0.85rem; margin-top:5px;">
                    <p>🏪 <b>Haradan:</b> ${sName} (<a href="tel:${sPhone}">${sPhone}</a>)</p>
                    <p>🏁 <b>Hara:</b> ${o.dropoff_address}</p>
                    <p>👤 Alıcı: ${o.recipient_name} (<a href="tel:${o.recipient_phone}">${o.recipient_phone}</a>)</p>
                </div>`;
            }
            list.innerHTML += `<div class="order-card" style="border-left:5px solid #ccc; opacity:0.9;"><div class="order-header"><span>${o.item_name}</span> <span>${o.price} ₼</span></div><div class="route-info">${details} <br> <i class="far fa-clock"></i> ${date}</div><div style="text-align:right; color:var(--primary); font-weight:bold;">✅ Tamamlanıb</div></div>`;
        });
    },

    toggleOnlineStatus: async () => {
        const is = document.getElementById("onlineToggle").checked;
        if (is) app.playAlert();
        await supabaseClient
            .from("profiles")
            .update({ is_online: is })
            .eq("id", app.currentUser.id);
        app.fetchOrders();
    },
    openSettings: () => {
        app.toggleSidebar();
        app.showScreen("screen-settings");
        document.getElementById("set-name").value = app.currentUser.full_name;
        document.getElementById("set-phone").value = app.currentUser.phone;
        const dc = document.getElementById("settings-dynamic-fields");
        dc.innerHTML =
            app.currentRole === "seller"
                ? `<label style="font-size:0.8rem;color:#666;">Mağaza Adı:</label><input type="text" id="set-shop-name" value="${app.currentUser.shop_name || ""
                }"><label style="font-size:0.8rem;color:#666;">Mağaza Ünvanı:</label><input type="text" id="set-shop-address" value="${app.currentUser.shop_address || ""
                }">`
                : `<label style="font-size:0.8rem;color:#666;">Nəqliyyat:</label><select id="set-vehicle" style="width:100%;padding:14px;margin-bottom:12px;border:2px solid #e2e8f0;border-radius:12px;background:#f1f5f9;"><option value="moto">Motosiklet</option><option value="car">Avtomobil</option><option value="bicycle">Velosiped</option></select><label style="font-size:0.8rem;color:#666;">Nömrə Nişanı:</label><input type="text" id="set-plate" value="${app.currentUser.vehicle_plate || ""
                }">`;
    },
    saveSettings: async () => {
        const name = document.getElementById("set-name").value;
        const phone = document.getElementById("set-phone").value;
        if (!name || !phone)
            return app.showToast("Vacib xanaları doldurun", "error");
        let updates = { full_name: name, phone: phone };
        if (app.currentRole === "seller") {
            updates.shop_name = document.getElementById("set-shop-name").value;
            updates.shop_address = document.getElementById("set-shop-address").value;
        } else {
            updates.vehicle_type = document.getElementById("set-vehicle").value;
            updates.vehicle_plate = document.getElementById("set-plate").value;
        }
        const { error } = await supabaseClient
            .from("profiles")
            .update(updates)
            .eq("id", app.currentUser.id);
        if (error) app.showToast("Xəta", "error");
        else {
            app.showToast("Yadda saxlanıldı", "success");
            app.currentUser = { ...app.currentUser, ...updates };
            app.handleLoginSuccess(app.currentUser.id, false);
        }
    },

    showToast: (m, t = "info") => {
        const c = document.getElementById("toast-container");
        const e = document.createElement("div");
        e.className = `toast ${t}`;
        e.innerHTML = `<span>${m}</span>`;
        c.appendChild(e);
        setTimeout(() => e.classList.add("show"), 10);
        setTimeout(() => e.remove(), 3000);
    },
    playAlert: () => {
        const a = document.getElementById("notification-sound");
        if (a) {
            a.currentTime = 0;
            a.play().catch(() => { });
        }
    },
    sendBrowserNotification: (t, b) => {
        if ("Notification" in window && Notification.permission === "granted")
            new Notification(t, { body: b });
        else app.showToast(t, "success");
    },
    showDonateModal: () => {
        app.toggleSidebar();
        document.getElementById("donate-modal").classList.remove("hidden");
    },
    closeDonateModal: () =>
        document.getElementById("donate-modal").classList.add("hidden"),
    copyCard: () => {
        navigator.clipboard.writeText("4169000000000000");
        app.showToast("Kopyalandı!", "success");
    },
};

document.addEventListener("DOMContentLoaded", () => app.init());
