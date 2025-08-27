const { instance } = require("../config/razorpay")
const Course = require("../models/Course")
const crypto = require("crypto")
const User = require("../models/User")
const mailSender = require("../utils/mailSender")
const mongoose = require("mongoose")
const { courseEnrollmentEmail } = require("../mail/templates/courseEnrollmentEmail")
const { paymentSuccessEmail } = require("../mail/templates/paymentSuccessEmail")
const CourseProgress = require("../models/CourseProgress")

exports.capturePayment = async (req, res) => {
  try {
    const { courses } = req.body
    const userId = req.user.id

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "Please provide valid course IDs" 
      })
    }

    let totalAmount = 0
    const coursesToEnroll = []

    for (const courseId of courses) {
      try {
        const course = await Course.findById(courseId)
        if (!course) {
          return res.status(404).json({ 
            success: false, 
            message: `Course not found with ID: ${courseId}` 
          })
        }

        const uid = new mongoose.Types.ObjectId(userId)
        if (course.studentsEnroled.includes(uid)) {
          return res.status(400).json({ 
            success: false, 
            message: `Student is already enrolled in course: ${course.courseName}` 
          })
        }

        totalAmount += course.price
        coursesToEnroll.push(courseId)
      } catch (error) {
        console.error(`Error processing course ${courseId}:`, error)
        return res.status(500).json({ 
          success: false, 
          message: "Error processing courses" 
        })
      }
    }

    const options = {
      amount: Math.round(totalAmount * 100), // Convert to paise
      currency: "INR",
      receipt: `receipt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    }

    const paymentResponse = await instance.orders.create(options)
    
    res.status(200).json({
      success: true,
      message: "Order created successfully",
      data: paymentResponse,
      courses: coursesToEnroll // Return validated courses
    })

  } catch (error) {
    console.error("ORDER CREATION ERROR:", error)
    res.status(500).json({ 
      success: false, 
      message: "Could not create order",
      error: error.message 
    })
  }
}
exports.verifyPayments = async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature, 
      courses 
    } = req.body
    const userId = req.user.id

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !courses) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing payment verification details" 
      })
    }

    // Verify signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(body)
      .digest("hex")

    if (expectedSignature !== razorpay_signature) {
      return res.status(401).json({ 
        success: false, 
        message: "Payment verification failed: Invalid signature" 
      })
    }

    // Enroll student if signature is valid
    await enrollStudents(courses, userId, res)

    return res.status(200).json({ 
      success: true, 
      message: "Payment verified successfully" 
    })

  } catch (error) {
    console.error("VERIFICATION ERROR:", error)
    res.status(500).json({ 
      success: false, 
      message: "Payment verification failed",
      error: error.message 
    })
  }
}
exports.verifyPayment = async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature, 
      courses 
    } = req.body
    const userId = req.user.id

    if (!courses) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing course details" 
      })
    }

    // Skip payment verification and directly enroll the student
    await enrollStudents(courses, userId, res)

    return res.status(200).json({ 
      success: true, 
      message: "Enrollment successful" 
    })

  } catch (error) {
    console.error("ENROLLMENT ERROR:", error)
    res.status(500).json({ 
      success: false, 
      message: "Enrollment failed",
      error: error.message 
    })
  }
}

exports.sendPaymentSuccessEmail = async (req, res) => {
  try {
    const { orderId, paymentId, amount } = req.body
    const userId = req.user.id

    if (!orderId || !paymentId || !amount || !userId) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required details" 
      })
    }

    const student = await User.findById(userId)
    if (!student) {
      return res.status(404).json({ 
        success: false, 
        message: "Student not found" 
      })
    }

    await mailSender(
      student.email,
      `Payment Received`,
      paymentSuccessEmail(
        `${student.firstName} ${student.lastName}`,
        amount / 100,
        orderId,
        paymentId
      )
    )

    res.status(200).json({ 
      success: true, 
      message: "Payment success email sent" 
    })

  } catch (error) {
    console.error("EMAIL ERROR:", error)
    res.status(500).json({ 
      success: false, 
      message: "Could not send payment success email",
      error: error.message 
    })
  }
}

const enrollStudents = async (courses, userId, res) => {
  try {
    for (const courseId of courses) {
      // Enroll in course
      const enrolledCourse = await Course.findByIdAndUpdate(
        courseId,
        { $addToSet: { studentsEnroled: userId } },
        { new: true }
      )

      if (!enrolledCourse) {
        console.error(`Course not found: ${courseId}`)
        continue // Skip to next course instead of failing entire operation
      }

      // Create course progress
      const courseProgress = await CourseProgress.create({
        courseID: courseId,
        userId: userId,
        completedVideos: [],
      })

      // Update user's courses and progress
      await User.findByIdAndUpdate(
        userId,
        {
          $addToSet: {
            courses: courseId,
            courseProgress: courseProgress._id,
          },
        }
      )

      // Send enrollment email
      const student = await User.findById(userId)
      if (student) {
        await mailSender(
          student.email,
          `Successfully Enrolled into ${enrolledCourse.courseName}`,
          courseEnrollmentEmail(
            enrolledCourse.courseName,
            `${student.firstName} ${student.lastName}`
          )
        )
      }
    }
  } catch (error) {
    console.error("ENROLLMENT ERROR:", error)
    throw error // Let the calling function handle it
  }
}