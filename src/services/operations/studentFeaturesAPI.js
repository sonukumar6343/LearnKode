import { toast } from "react-hot-toast"
import rzpLogo from "../../assets/Logo/rzp_logo.png"
import { resetCart } from "../../slices/cartSlice"
import { setPaymentLoading } from "../../slices/courseSlice"
import { apiConnector } from "../apiConnector"
import { studentEndpoints } from "../apis"

const {
  COURSE_PAYMENT_API,
  COURSE_VERIFY_API,
  SEND_PAYMENT_SUCCESS_EMAIL_API,
} = studentEndpoints

// Load the Razorpay SDK from the CDN
function loadScript(src) {
  return new Promise((resolve) => {
    const script = document.createElement("script")
    script.src = src
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export async function BuyCourse(token, courses, user_details, navigate, dispatch) {
  const toastId = toast.loading("Initializing payment...")
  try {
    // Load Razorpay SDK
    const isRazorpayLoaded = await loadScript("https://checkout.razorpay.com/v1/checkout.js")
    if (!isRazorpayLoaded) {
      toast.error("Razorpay SDK failed to load. Check your Internet Connection.")
      return
    }

    // Create order in backend
    const orderResponse = await apiConnector(
      "POST",
      COURSE_PAYMENT_API,
      { courses },
      { Authorization: `Bearer ${token}` }
    )

    if (!orderResponse.data.success) {
      throw new Error(orderResponse.data.message)
    }

    // Configure Razorpay options
    const options = {
      key: process.env.REACT_APP_RAZORPAY_KEY,
      currency: orderResponse.data.data.currency,
      amount: orderResponse.data.data.amount,
      order_id: orderResponse.data.data._id,
      name: "Learn Kode",
      description: "Thank you for Purchasing the Course.",
      image: rzpLogo,
      prefill: {
        name: `${user_details.firstName} ${user_details.lastName}`,
        email: user_details.email,
      },
      handler: async function (response) {
        try {
          await verifyPayment({ ...response, courses }, token, navigate, dispatch)
          await sendPaymentSuccessEmail(response, orderResponse.data.data.amount, token)
        } catch (error) {
          console.error("Payment completion error:", error)
          toast.error("Payment completed but verification failed. Please contact support.")
        }
      },
    }

    const paymentObject = new window.Razorpay(options)
    
    paymentObject.on("payment.failed", function (response) {
      toast.error(`Payment Failed: ${response.error.description}`)
      console.error("Payment failed:", response.error)
    })

    paymentObject.open()
  } catch (error) {
    console.error("PAYMENT ERROR:", error)
    toast.error(error.message || "Could not initiate payment")
  } finally {
    toast.dismiss(toastId)
  }
}

async function verifyPayment(bodyData, token, navigate, dispatch) {
  const toastId = toast.loading("Verifying payment...")
  dispatch(setPaymentLoading(true))
  
  try {
    const response = await apiConnector(
      "POST", 
      COURSE_VERIFY_API, 
      bodyData, 
      { Authorization: `Bearer ${token}` }
    )

    if (!response.data.success) {
      throw new Error(response.data.message)
    }

    toast.success("Payment verified successfully!")
    dispatch(resetCart())
    navigate("/dashboard/enrolled-courses")
  } catch (error) {
    console.error("VERIFICATION ERROR:", error)
    toast.error(error.message || "Payment verification failed")
    throw error // Re-throw to be caught in handler
  } finally {
    toast.dismiss(toastId)
    dispatch(setPaymentLoading(false))
  }
}

async function sendPaymentSuccessEmail(response, amount, token) {
  try {
    await apiConnector(
      "POST",
      SEND_PAYMENT_SUCCESS_EMAIL_API,
      {
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        amount: amount,
      },
      { Authorization: `Bearer ${token}` }
    )
  } catch (error) {
    console.error("EMAIL ERROR:", error)
    // Don't throw error as email failure shouldn't block user flow
  }
}