-- OSRM profile: the stock car profile, biased toward roads the pipeline scored
-- as scenic. Wraps car.lua rather than forking it, so upstream fixes come free.

-- The stock profiles live in /opt inside the OSRM image, which is not on the
-- Lua path when the profile is mounted from elsewhere.
package.path = package.path .. ";/opt/?.lua"

local car = require("car")

local scenic = {}
for key, value in pairs(car) do scenic[key] = value end

-- Rate is preference, weight is length/rate, so a higher rate makes a road
-- cheaper to route over. Duration is deliberately left alone: the ETA should
-- tell the truth about a detour, not pretend the scenic road is quicker.
local BOOST_PER_POINT = 0.15

function scenic.setup()
  local profile = car.setup()
  -- With weight_name 'duration' the rate is ignored and this profile becomes
  -- the plain car profile with extra steps.
  profile.properties.weight_name = "routability"
  return profile
end

function scenic.process_way(profile, way, result, relations)
  car.process_way(profile, way, result, relations)

  local score = tonumber(way:get_value_by_key("scenic_score"))
  if not score or score <= 0 then
    return
  end

  local boost = 1 + score * BOOST_PER_POINT
  if result.forward_rate then
    result.forward_rate = result.forward_rate * boost
  end
  if result.backward_rate then
    result.backward_rate = result.backward_rate * boost
  end
end

return scenic
