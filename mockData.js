const MOCK_PLACES = [
  // --- RESTAURANTS ---
  {
    place_id: "mock_r1",
    name: "The Grand Kitchen",
    types: ["restaurant", "food", "establishment"],
    category: "Restaurant",
    rating: 4.5,
    user_ratings_total: 1842,
    formatted_address: "14 Marine Drive, Mumbai, Maharashtra 400020, India",
    formatted_phone_number: "+91 22 6654 3210",
    website: "https://thegrandkitchen.in",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "mumbai"
  },
  {
    place_id: "mock_r2",
    name: "Spice Route Bistro",
    types: ["restaurant", "food", "establishment"],
    category: "Restaurant",
    rating: 4.2,
    user_ratings_total: 934,
    formatted_address: "22 Connaught Place, New Delhi 110001, India",
    formatted_phone_number: "+91 11 4567 8901",
    website: "https://spiceroutebistro.com",
    opening_hours: { open_now: false },
    business_status: "OPERATIONAL",
    city: "delhi"
  },
  {
    place_id: "mock_r3",
    name: "Bangalore Brew & Grill",
    types: ["restaurant", "bar", "establishment"],
    category: "Restaurant",
    rating: 4.7,
    user_ratings_total: 2310,
    formatted_address: "7 Indiranagar 100ft Rd, Bengaluru, Karnataka 560038, India",
    formatted_phone_number: "+91 80 2345 6789",
    website: "https://bangalorebrew.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "bangalore"
  },
  {
    place_id: "mock_r4",
    name: "The Ivy Brasserie",
    types: ["restaurant", "food", "establishment"],
    category: "Restaurant",
    rating: 4.6,
    user_ratings_total: 5421,
    formatted_address: "1-5 West Street, London WC2H 9NQ, United Kingdom",
    formatted_phone_number: "+44 20 7836 4751",
    website: "https://the-ivy.co.uk",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "london"
  },
  {
    place_id: "mock_r5",
    name: "Al Fanar Restaurant",
    types: ["restaurant", "food", "establishment"],
    category: "Restaurant",
    rating: 4.4,
    user_ratings_total: 3872,
    formatted_address: "Festival City Mall, Dubai, UAE",
    formatted_phone_number: "+971 4 232 9966",
    website: "https://alfanarrestaurant.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "dubai"
  },

  // --- GYMS ---
  {
    place_id: "mock_g1",
    name: "FitZone Premium Gym",
    types: ["gym", "health", "establishment"],
    category: "Gym",
    rating: 4.3,
    user_ratings_total: 712,
    formatted_address: "Andheri West, Mumbai, Maharashtra 400058, India",
    formatted_phone_number: "+91 98765 43210",
    website: "https://fitzonegym.in",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "mumbai"
  },
  {
    place_id: "mock_g2",
    name: "Iron Paradise Fitness",
    types: ["gym", "health", "establishment"],
    category: "Gym",
    rating: 4.6,
    user_ratings_total: 489,
    formatted_address: "Sector 18, Noida, Uttar Pradesh 201301, India",
    formatted_phone_number: "+91 97654 32109",
    website: "https://ironparadise.in",
    opening_hours: { open_now: false },
    business_status: "OPERATIONAL",
    city: "delhi"
  },
  {
    place_id: "mock_g3",
    name: "Gold's Gym HSR Layout",
    types: ["gym", "health", "establishment"],
    category: "Gym",
    rating: 4.1,
    user_ratings_total: 1023,
    formatted_address: "27th Main, HSR Layout, Bengaluru, Karnataka 560102, India",
    formatted_phone_number: "+91 80 6789 0123",
    website: "https://goldsgym.in",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "bangalore"
  },
  {
    place_id: "mock_g4",
    name: "Crunch Fitness New York",
    types: ["gym", "health", "establishment"],
    category: "Gym",
    rating: 4.4,
    user_ratings_total: 2891,
    formatted_address: "404 Lafayette St, New York, NY 10003, USA",
    formatted_phone_number: "+1 212-420-0507",
    website: "https://crunch.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "new york"
  },

  // --- DOCTORS / CLINICS ---
  {
    place_id: "mock_d1",
    name: "Apollo Clinic Bandra",
    types: ["doctor", "health", "establishment"],
    category: "Doctor",
    rating: 4.5,
    user_ratings_total: 643,
    formatted_address: "Shop 7, Hill Rd, Bandra West, Mumbai 400050, India",
    formatted_phone_number: "+91 22 6789 1234",
    website: "https://apolloclinic.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "mumbai"
  },
  {
    place_id: "mock_d2",
    name: "Max Healthcare Saket",
    types: ["hospital", "doctor", "health"],
    category: "Doctor",
    rating: 4.3,
    user_ratings_total: 2190,
    formatted_address: "2 Press Enclave Rd, Saket, New Delhi 110017, India",
    formatted_phone_number: "+91 11 2651 5050",
    website: "https://maxhealthcare.in",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "delhi"
  },
  {
    place_id: "mock_d3",
    name: "Manipal Hospitals Whitefield",
    types: ["hospital", "doctor", "health"],
    category: "Doctor",
    rating: 4.2,
    user_ratings_total: 1542,
    formatted_address: "Whitefield Rd, Whitefield, Bengaluru, Karnataka 560066, India",
    formatted_phone_number: "+91 80 2222 4444",
    website: "https://manipalhospitals.com",
    opening_hours: { open_now: false },
    business_status: "OPERATIONAL",
    city: "bangalore"
  },
  {
    place_id: "mock_d4",
    name: "Cleveland Clinic",
    types: ["hospital", "doctor", "health"],
    category: "Doctor",
    rating: 4.8,
    user_ratings_total: 7823,
    formatted_address: "9500 Euclid Ave, Cleveland, OH 44195, USA",
    formatted_phone_number: "+1 800-223-2273",
    website: "https://my.clevelandclinic.org",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "new york"
  },

  // --- MOBILE SHOPS ---
  {
    place_id: "mock_m1",
    name: "Croma Electronics Powai",
    types: ["electronics_store", "store", "establishment"],
    category: "Mobile Shop",
    rating: 4.1,
    user_ratings_total: 891,
    formatted_address: "R City Mall, LBS Marg, Ghatkopar, Mumbai 400086, India",
    formatted_phone_number: "+91 1800 267 2662",
    website: "https://croma.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "mumbai"
  },
  {
    place_id: "mock_m2",
    name: "Samsung SmartCafé Rajouri",
    types: ["electronics_store", "store", "establishment"],
    category: "Mobile Shop",
    rating: 4.0,
    user_ratings_total: 342,
    formatted_address: "Rajouri Garden, New Delhi 110027, India",
    formatted_phone_number: "+91 11 2510 0000",
    website: "https://samsung.com/in",
    opening_hours: { open_now: false },
    business_status: "OPERATIONAL",
    city: "delhi"
  },
  {
    place_id: "mock_m3",
    name: "Reliance Digital Koramangala",
    types: ["electronics_store", "store", "establishment"],
    category: "Mobile Shop",
    rating: 4.2,
    user_ratings_total: 1104,
    formatted_address: "Forum Mall, Hosur Rd, Koramangala, Bengaluru 560095, India",
    formatted_phone_number: "+91 80 3345 5566",
    website: "https://reliancedigital.in",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "bangalore"
  },
  {
    place_id: "mock_m4",
    name: "Apple Store Fifth Avenue",
    types: ["electronics_store", "store", "establishment"],
    category: "Mobile Shop",
    rating: 4.6,
    user_ratings_total: 18423,
    formatted_address: "767 5th Ave, New York, NY 10153, USA",
    formatted_phone_number: "+1 212-336-1440",
    website: "https://apple.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "new york"
  },

  // --- HOTELS ---
  {
    place_id: "mock_h1",
    name: "Taj Mahal Palace",
    types: ["lodging", "hotel", "establishment"],
    category: "Hotel",
    rating: 4.8,
    user_ratings_total: 9231,
    formatted_address: "Apollo Bunder, Colaba, Mumbai 400001, India",
    formatted_phone_number: "+91 22 6665 3366",
    website: "https://tajhotels.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "mumbai"
  },
  {
    place_id: "mock_h2",
    name: "The Leela Palace New Delhi",
    types: ["lodging", "hotel", "establishment"],
    category: "Hotel",
    rating: 4.7,
    user_ratings_total: 4109,
    formatted_address: "Diplomatic Enclave, Chanakyapuri, New Delhi 110023, India",
    formatted_phone_number: "+91 11 3933 1234",
    website: "https://theleela.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "delhi"
  },
  {
    place_id: "mock_h3",
    name: "Burj Al Arab Jumeirah",
    types: ["lodging", "hotel", "establishment"],
    category: "Hotel",
    rating: 4.9,
    user_ratings_total: 22841,
    formatted_address: "Jumeirah St, Dubai, UAE",
    formatted_phone_number: "+971 4 301 7777",
    website: "https://jumeirah.com",
    opening_hours: { open_now: true },
    business_status: "OPERATIONAL",
    city: "dubai"
  }
];

function searchMockData(keyword, location) {
  const kw = keyword.toLowerCase().trim();
  const loc = location.toLowerCase().trim();

  const categoryMap = {
    restaurant: ["restaurant", "food", "cafe", "bistro", "dine", "dining", "eat"],
    gym: ["gym", "fitness", "workout", "exercise", "crossfit"],
    doctor: ["doctor", "clinic", "hospital", "medical", "health", "physician"],
    "mobile shop": ["mobile", "phone", "electronics", "gadget", "apple", "samsung"],
    hotel: ["hotel", "lodge", "stay", "resort", "inn", "accommodation"]
  };

  return MOCK_PLACES.filter(place => {
    const matchesCity = !loc || place.city.includes(loc) || loc.includes(place.city);

    let matchesKeyword = false;
    for (const [cat, terms] of Object.entries(categoryMap)) {
      if (terms.some(t => kw.includes(t) || t.includes(kw))) {
        if (place.category.toLowerCase() === cat) {
          matchesKeyword = true;
          break;
        }
      }
    }
    if (!matchesKeyword) {
      matchesKeyword =
        place.name.toLowerCase().includes(kw) ||
        place.category.toLowerCase().includes(kw) ||
        place.types.some(t => t.includes(kw));
    }

    return matchesCity && matchesKeyword;
  });
}
